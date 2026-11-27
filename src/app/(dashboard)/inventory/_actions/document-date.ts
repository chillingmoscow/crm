"use server";

// Смена даты акта инвентаризации с отправкой в Quick Resto.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { writeAuditEvent } from "@/lib/audit/write";
import { isBackOfficePermissionError } from "@/lib/integrations/quickresto/auth-state";
import {
  readInventoryDocument,
  readInventoryDocumentBackOffice,
  updateInventoryDocumentDateBackOffice,
  type QuickRestoInventoryDocument2,
  type QuickRestoInventoryDocumentBackOffice,
} from "@/lib/integrations/quickresto/client";
import {
  backOfficeTimeZoneParam,
  getInventoryDateLockReason,
  invoiceDayInZone,
  isCalendarDay,
  moveInvoiceDateToDay,
} from "@/lib/inventory/act-date";
import {
  DOCUMENT_CHANGED_ERROR,
  actionErrorMessage,
  assertDocumentVisible,
  connectionPassword,
  dateText,
  getActiveContext,
  getConnection,
  isDocumentStatusStill,
  listBackOfficeInventoryItemsWithSession,
  refreshLocalInventoryDocumentFromPayload,
  withBackOfficeSession,
} from "../actions-shared";

/** Пояс, если у заведения он не задан: заведения аккаунта — в Москве. */
const DEFAULT_TIME_ZONE = "Europe/Moscow";

/** Статусы непроведённого акта: смена даты допустима только в них. */
const OPEN_STATUSES = [
  "synced",
  "assigned",
  "in_progress",
  "ready_for_review",
  "results_blocked",
  "recount_pending",
] as const;

type DateDocumentRow = {
  id: string;
  external_id: string | null;
  document_number: string | null;
  status: string;
  processed: boolean | null;
  results_finalized_at: string | null;
  archived_at: string | null;
  invoice_date: string | null;
  venue_id: string | null;
};

export type UpdateInventoryDocumentDateResult = {
  error: string | null;
  /** Дата сменилась, но что-то после неё не получилось — сказать пользователю. */
  notice?: string;
};

/**
 * Перенести акт на другой день. Время суток акта сохраняется (меняется только
 * день в поясе заведения), запись идёт в Quick Resto, затем акт перечитывается:
 * Quick Resto считает расчётный остаток на дату акта, поэтому после смены даты
 * расчётные остатки и разница позиций другие.
 *
 * Только для непроведённого акта с открытыми итогами, право
 * `inventory.manage_documents`.
 */
export async function updateInventoryDocumentDate(input: {
  documentId: string;
  /** Новый день акта, `YYYY-MM-DD`. */
  date: string;
}): Promise<UpdateInventoryDocumentDateResult> {
  const ctx = await getActiveContext("inventory.manage_documents");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error ?? "Недостаточно прав" };
  if (!isCalendarDay(input.date)) return { error: "Выберите дату акта" };

  const admin = asLooseDb(createAdminClient());
  try {
    await assertDocumentVisible({ supabase: ctx.supabase, documentId: input.documentId });
    const { data: document } = await admin
      .from<DateDocumentRow>("documents")
      .select(
        "id, external_id, document_number, status, processed, results_finalized_at, archived_at, invoice_date, venue_id",
      )
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!document?.id) return { error: "Акт не найден" };

    const lockReason = getInventoryDateLockReason(document);
    if (lockReason) return { error: lockReason };

    const externalId = Number(document.external_id);
    if (!document.external_id || !Number.isFinite(externalId)) {
      return { error: "Акт не связан с Quick Resto — дату изменить нельзя." };
    }

    const timeZone = (await venueTimeZone(admin, document.venue_id)) ?? DEFAULT_TIME_ZONE;
    const connection = await getConnection(ctx.accountId);
    if (!connection) return { error: "Активное подключение Quick Resto не найдено" };
    const password = connectionPassword(connection);
    const readQr = () =>
      readInventoryDocument({
        layerName: connection.login,
        login: connection.login,
        password,
        objectId: externalId,
      });

    // Дату и признак проведения берём у Quick Resto, а не из нашей копии:
    // её могли поменять там после последней синхронизации.
    let qrDocument: QuickRestoInventoryDocument2;
    try {
      qrDocument = await readQr();
    } catch (error) {
      console.error("[updateInventoryDocumentDate] read failed", error);
      return { error: "Не удалось прочитать акт в Quick Resto. Попробуйте ещё раз." };
    }
    if (qrDocument.processed) {
      return { error: "Акт уже проведён в Quick Resto — дату проведённого акта изменить нельзя." };
    }
    const qrInvoiceDate = dateText(qrDocument.invoiceDate) ?? document.invoice_date;
    const oldDay = invoiceDayInZone(qrInvoiceDate, timeZone);
    if (oldDay === input.date) {
      // День уже тот: дату могли поменять в Quick Resto после синхронизации —
      // подтягиваем её к себе, чтобы карточка не показывала старую.
      if (qrInvoiceDate && qrInvoiceDate !== document.invoice_date &&
          Date.parse(qrInvoiceDate) !== Date.parse(document.invoice_date ?? "")) {
        await admin
          .from("documents")
          .update({ invoice_date: qrInvoiceDate })
          .eq("id", document.id)
          .eq("account_id", ctx.accountId);
        revalidateDocument(document.id);
      }
      return { error: null };
    }

    const invoiceDate = moveInvoiceDateToDay({ original: qrInvoiceDate, day: input.date, timeZone });
    if (invoiceDate === null) return { error: "Выберите дату акта" };

    // Свежая проверка прямо перед записью в Quick Resto: акт могли провести или
    // зафиксировать итоги, пока мы читали.
    const stillOpen = await isDocumentStatusStill({
      admin,
      accountId: ctx.accountId,
      documentId: document.id,
      from: OPEN_STATUSES,
      finalized: "open",
    });
    if (!stillOpen) return { error: DOCUMENT_CHANGED_ERROR };

    try {
      const applied = await withBackOfficeSession({
        connection,
        admin,
        run: async (authorization) => {
          // Тело записи — акт целиком из бэк-офиса (с `version` и автором):
          // public `read` этих полей не отдаёт, и запись по нему их бы стёрла.
          const backOfficeDocument = await readInventoryDocumentBackOffice({
            layerName: connection.login,
            baseUrl: connection.backoffice_base_url,
            authorization,
            id: externalId,
          });
          if (backOfficeDocument.id !== externalId) return "missing" as const;
          if (isBackOfficeDocumentProcessed(backOfficeDocument)) return "processed" as const;
          await updateInventoryDocumentDateBackOffice({
            layerName: connection.login,
            baseUrl: connection.backoffice_base_url,
            authorization,
            document: backOfficeDocument,
            invoiceDate,
            timeZoneOffset: backOfficeTimeZoneParam(invoiceDate, timeZone),
          });
          return "updated" as const;
        },
      });
      if (applied === "missing") return { error: "Акт не найден в Quick Resto." };
      if (applied === "processed") {
        return { error: "Акт уже проведён в Quick Resto — дату проведённого акта изменить нельзя." };
      }
    } catch (error) {
      console.error("[updateInventoryDocumentDate] update failed", error);
      if (isBackOfficePermissionError(error)) {
        return {
          error: "У пользователя Sheerly Bot в Quick Resto нет прав менять акты инвентаризации.",
        };
      }
      return { error: "Quick Resto не принял новую дату акта. Попробуйте ещё раз." };
    }

    // С этого места Quick Resto запись принял: что бы ни случилось дальше,
    // событие пишем в журнал, а нашу строку сверяем с тем, что сохранилось там.
    const accountId = ctx.accountId;
    const userId = ctx.user.id;
    const audit = (newDay: string | null, details: Record<string, unknown> = {}) =>
      writeAuditEvent({
        accountId,
        venueId: document.venue_id ?? ctx.venueId,
        userId,
        actionCode: "inventory.document_date_updated",
        entityType: "inventory_document",
        entityId: document.id,
        details: {
          number: document.document_number,
          date: newDay ?? input.date,
          ...details,
          changes: [{ field: "invoice_date", old: oldDay, new: newDay ?? input.date }],
        },
      });

    // Проверяем, что дата правда сменилась и именно на этот момент: ответ
    // записи этого не гарантирует, а при неверном поясе Quick Resto сдвигает
    // время акта на часы.
    let saved: QuickRestoInventoryDocument2;
    try {
      saved = await readQr();
    } catch (error) {
      console.error("[updateInventoryDocumentDate] verify read failed", error);
      await audit(null, { unverified: true });
      return {
        error:
          "Дата отправлена в Quick Resto, но перечитать акт не удалось. Нажмите «Синхронизировать», чтобы увидеть текущую дату.",
      };
    }
    const savedInvoiceDate = dateText(saved.invoiceDate);
    const savedDay = invoiceDayInZone(savedInvoiceDate, timeZone);

    let notice: string | undefined;
    if (savedInvoiceDate) {
      const { data: updated, error: updateError } = await admin
        .from<Array<{ id: string }>>("documents")
        .update({ invoice_date: savedInvoiceDate })
        .eq("id", document.id)
        .eq("account_id", ctx.accountId)
        .select("id");
      // Quick Resto дату уже принял — ближайшая синхронизация её подтянет.
      if (updateError || (updated ?? []).length === 0) {
        console.error("[updateInventoryDocumentDate] local update failed", updateError);
        notice = "Дата изменена в Quick Resto, но здесь ещё не обновилась. Нажмите «Синхронизировать».";
      }
    }

    if (!savedInvoiceDate || Date.parse(savedInvoiceDate) !== invoiceDate) {
      console.error("[updateInventoryDocumentDate] date not applied", {
        documentId: document.id,
        expected: new Date(invoiceDate).toISOString(),
        actual: savedInvoiceDate,
      });
      if (savedDay && savedDay !== oldDay) await audit(savedDay, { mismatch: true });
      revalidateDocument(document.id);
      return {
        error:
          savedDay === input.date
            ? "Quick Resto сохранил дату акта с другим временем — проверьте акт в Quick Resto."
            : "Quick Resto не сохранил новую дату акта. Попробуйте ещё раз или измените её в Quick Resto.",
      };
    }

    await audit(input.date);

    // Расчётные остатки теперь на новую дату — перечитываем позиции. Дата уже
    // сменилась, поэтому сбой здесь — не ошибка действия, а повод обновить акт.
    try {
      const items = await listBackOfficeInventoryItemsWithSession({
        connection,
        admin,
        documentExternalId: externalId,
      });
      const refreshed = await refreshLocalInventoryDocumentFromPayload({
        admin,
        accountId: ctx.accountId,
        documentId: document.id,
        document: { ...saved, effectedItems: items.length > 0 ? items : saved.effectedItems },
        keepStatus: true,
      });
      if (refreshed.skippedEmptyPayload || refreshed.skippedStaleDeletion > 0) {
        notice ??= "Дата изменена, но Quick Resto вернул не все позиции. Нажмите «Синхронизировать», чтобы обновить расчётные остатки.";
      }
    } catch (error) {
      console.error("[updateInventoryDocumentDate] items refresh failed", error);
      notice ??= "Дата изменена, но расчётные остатки обновить не удалось. Нажмите «Синхронизировать».";
    }

    revalidateDocument(document.id);
    return { error: null, ...(notice ? { notice } : {}) };
  } catch (error) {
    console.error("[updateInventoryDocumentDate] unhandled error", error);
    return { error: actionErrorMessage(error, "Не удалось изменить дату акта") };
  }
}

function revalidateDocument(documentId: string) {
  revalidatePath("/documents/inventory");
  revalidatePath(`/documents/inventory/${documentId}`, "layout");
}

/** Проведён ли акт по ответу бэк-офиса: `processed` или иной `processingState`. */
function isBackOfficeDocumentProcessed(document: QuickRestoInventoryDocumentBackOffice): boolean {
  if (document.processed) return true;
  return typeof document.processingState === "string" && document.processingState !== "UNPROCESSED";
}

async function venueTimeZone(
  admin: ReturnType<typeof asLooseDb>,
  venueId: string | null,
): Promise<string | null> {
  if (!venueId) return null;
  const { data } = await admin
    .from<{ timezone: string | null }>("venues")
    .select("timezone")
    .eq("id", venueId)
    .maybeSingle();
  return data?.timezone ?? null;
}
