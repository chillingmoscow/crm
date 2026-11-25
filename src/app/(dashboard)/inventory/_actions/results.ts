"use server";

// Итоги акта: пересчёт, комментарий, фиксация и распроведение.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { getCachedPermissionChecker } from "@/lib/supabase/server";
import { getInventoryResultRefreshLockReason } from "@/lib/inventory/act-status";
import {
  readInventoryDocument,
  type QuickRestoInventoryDocument2
} from "@/lib/integrations/quickresto/client";
import {
  autoRecalculateInventoryDeduction,
  reverseInventoryDeductionForDocument,
} from "../deduction-service";
import {
  DOCUMENT_CHANGED_ERROR,
  actionErrorMessage,
  assertDocumentVisible,
  connectionPassword,
  getActiveContext,
  getConnection,
  getResultDocumentForAction,
  listBackOfficeInventoryItemsWithSession,
  normalizeReason,
  notifyInventoryDocumentEvent,
  refreshLocalInventoryDocumentFromPayload,
  revalidateInventoryResultPages,
  text,
  transitionDocumentStatus,
  writeInventoryResultEvent
} from "../actions-shared";
import { finalizeInventoryDocumentCore } from "../finalize-core";

export async function refreshInventoryDocumentResults(input: {
  documentId: string;
}): Promise<{
  processed: boolean;
  resultsHasLineAmounts: boolean;
  error: string | null;
}> {
  // «Обновить итоги» — управленческая операция (перечитывает итоги из QR,
  // меняет статус/позиции). Требует именно право на итоги: назначенный
  // исполнитель, который просто смотрит проведённый акт, её не запускает.
  const ctx = await getActiveContext("inventory.view_results");
  if (ctx.error || !ctx.user || !ctx.accountId) {
    return { processed: false, resultsHasLineAmounts: false, error: ctx.error };
  }

  const can = await getCachedPermissionChecker();
  const canViewResults = can("inventory.view_results");
  const canViewDocuments = can("inventory.view_documents");
  const canFill = can("inventory.fill_assigned_documents");
  if (!canViewResults) {
    return { processed: false, resultsHasLineAmounts: false, error: "Недостаточно прав" };
  }

  const admin = asLooseDb(createAdminClient());
  try {
    await assertDocumentVisible({ supabase: ctx.supabase, documentId: input.documentId });
  } catch (visibilityError) {
    return {
      processed: false,
      resultsHasLineAmounts: false,
      error: actionErrorMessage(visibilityError, "Акт не найден"),
    };
  }
  const { data: document } = await admin
    .from<{
      id: string;
      account_id: string;
      external_id: string;
      assigned_to: string | null;
      status: string;
      results_finalized_at: string | null;
      results_reopened_at: string | null;
    }>("documents")
    .select("id, account_id, external_id, assigned_to, status, results_finalized_at, results_reopened_at")
    .eq("id", input.documentId)
    .eq("account_id", ctx.accountId)
    .maybeSingle();

  if (!document?.id) {
    return { processed: false, resultsHasLineAmounts: false, error: "Акт не найден" };
  }
  const allowed = canViewDocuments || (canFill && document.assigned_to === ctx.user.id);
  if (!allowed) {
    return { processed: false, resultsHasLineAmounts: false, error: "Недостаточно прав" };
  }

  // Импорт заменяет построчные итоги тем, что QR отдаёт СЕЙЧАС. На залоченных
  // итогах это молча перезаписывает утверждённые числа — так и потерялись итоги
  // акта СВ340. Легальный путь — сначала переоткрыть итоги.
  const refreshLockReason = getInventoryResultRefreshLockReason(document);
  if (refreshLockReason) {
    return { processed: false, resultsHasLineAmounts: false, error: refreshLockReason };
  }

  const connection = await getConnection(ctx.accountId);
  if (!connection) {
    return { processed: false, resultsHasLineAmounts: false, error: "Активное подключение Quick Resto не найдено" };
  }

  try {
    const password = connectionPassword(connection);
    const qrDocument = await readInventoryDocument({
      layerName: connection.login,
      login: connection.login,
      password,
      objectId: Number(document.external_id),
    });
    const documentExternalId = Number(document.external_id);
    if (!Number.isFinite(documentExternalId)) {
      return { processed: false, resultsHasLineAmounts: false, error: "У акта некорректный ID Quick Resto" };
    }
    const backOfficeItems = await listBackOfficeInventoryItemsWithSession({
      connection,
      admin,
      documentExternalId,
    });
    const documentWithRows: QuickRestoInventoryDocument2 = {
      ...qrDocument,
      effectedItems: backOfficeItems.length > 0 ? backOfficeItems : qrDocument.effectedItems,
    };
    const syncResult = await refreshLocalInventoryDocumentFromPayload({
      admin,
      accountId: ctx.accountId,
      documentId: document.id,
      document: documentWithRows,
      status: qrDocument.processed ? "processed" : undefined,
    });

    // Quick Resto ответил без позиций — данные акта мы намеренно не тронули.
    // Раньше это молча удаляло все строки; теперь говорим об этом вслух, иначе
    // пользователь решит, что «обновилось» и цифры актуальны.
    if (syncResult.skippedEmptyPayload) {
      return {
        processed: Boolean(qrDocument.processed),
        resultsHasLineAmounts: false,
        error:
          "Quick Resto не вернул позиции акта — данные оставлены без изменений. Попробуйте ещё раз через минуту.",
      };
    }

    revalidatePath("/documents/inventory");
    revalidatePath(`/documents/inventory/${document.id}`);
    revalidatePath(`/documents/inventory/${document.id}/results`);

    // Ответ выглядел обрезанным: строки, которых в нём не было, мы НЕ удалили
    // (иначе снесли бы снимок итогов и половины пересортов). Молчать нельзя —
    // остальные строки обновились, и пользователь решит, что акт актуален.
    if (syncResult.skippedStaleDeletion > 0) {
      return {
        processed: Boolean(qrDocument.processed),
        resultsHasLineAmounts: syncResult.resultsFound,
        error: `Quick Resto вернул неполный список позиций — не хватает ${syncResult.skippedStaleDeletion}. Строки акта сохранены, но данные могут быть неактуальны: повторите обновление через минуту.`,
      };
    }

    return {
      processed: Boolean(qrDocument.processed),
      resultsHasLineAmounts: syncResult.resultsFound,
      error: null,
    };
  } catch (error) {
    return {
      processed: false,
      resultsHasLineAmounts: false,
      error: actionErrorMessage(error, "Не удалось обновить итоги из Quick Resto"),
    };
  }
}

export async function updateInventoryResultComment(input: {
  documentId: string;
  itemId: string;
  comment: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.comment_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    await getResultDocumentForAction({
      admin,
      supabase: ctx.supabase,
      accountId: ctx.accountId,
      documentId: input.documentId,
      requireOpen: true,
    });

    const comment = text(input.comment);
    const { data: item } = await admin
      .from<{ id: string; product_name: string }>("document_items")
      .select("id, product_name")
      .eq("id", input.itemId)
      .eq("document_id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!item?.id) throw new Error("Строка акта не найдена");

    const { error } = await admin
      .from("document_items")
      .update({
        result_comment: comment,
        result_comment_updated_by: comment ? ctx.user.id : null,
        result_comment_updated_at: comment ? new Date().toISOString() : null,
      })
      .eq("id", item.id)
      .eq("account_id", ctx.accountId);
    if (error) throw new Error(error.message);

    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: input.documentId,
      documentItemId: item.id,
      eventType: "comment_updated",
      message: comment
        ? `Комментарий к позиции «${item.product_name}» обновлен`
        : `Комментарий к позиции «${item.product_name}» очищен`,
      payload: { itemId: item.id, productName: item.product_name, comment },
    });

    revalidateInventoryResultPages(input.documentId);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось обновить комментарий") };
  }
}

export async function finalizeInventoryResults(input: {
  documentId: string;
}): Promise<{ error: string | null; notice?: string }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.finalize_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    // Видимость акта пользователю (RLS) — здесь, до общей функции: она читает
    // акт admin-клиентом и о сессии не знает.
    await assertDocumentVisible({ supabase: ctx.supabase, documentId: input.documentId });

    const result = await finalizeInventoryDocumentCore({
      admin,
      accountId: ctx.accountId,
      documentId: input.documentId,
      actorUserId: ctx.user.id,
      source: "manual",
    });
    if (!result.finalized) {
      // Ошибка или no-op (итоги уже финализированы). Страницы обновляем, только
      // если общая функция успела поменять данные акта.
      if (result.revalidate) revalidateInventoryResultPages(input.documentId);
      return { error: result.error };
    }

    const { document, alreadyProcessedInQr } = result.finalized;

    // Уведомляем исполнителя, что его акт принят.
    await notifyInventoryDocumentEvent({
      admin,
      recipientId: document.assigned_to,
      actorId: ctx.user.id,
      venueId: document.venue_id,
      documentId: document.id,
      type: "inventory.document.finalized",
      title: `Итоги акта № ${document.document_number} приняты`,
      body: "Проверяющий финализировал итоги инвентаризации.",
    });

    // Удержание по недостаче - только после того, как И Quick Resto, И локальная
    // финализация прошли. Повтор на уже финализированном акте сюда не доходит
    // (ранний выход выше), а повторный расчёт месяца идемпотентен по содержимому.
    const deductionNotice = await autoRecalculateInventoryDeduction({ kind: "document", documentId: document.id });

    revalidateInventoryResultPages(document.id);
    const notices = [
      alreadyProcessedInQr
        ? "Акт уже был проведён в Quick Resto — итоги зафиксированы локально, повторное проведение не потребовалось."
        : null,
      deductionNotice,
    ].filter((n): n is string => !!n);
    return {
      error: null,
      ...(notices.length > 0 ? { notice: notices.join(" ") } : {}),
    };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось финализировать итоги") };
  }
}

export async function reopenInventoryResults(input: {
  documentId: string;
  reason: string;
}): Promise<{ error: string | null; notice?: string }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.finalize_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    const reason = normalizeReason(input.reason, "Укажите причину переоткрытия итогов");
    const document = await getResultDocumentForAction({
      admin,
      supabase: ctx.supabase,
      accountId: ctx.accountId,
      documentId: input.documentId,
    });
    // Разблокировать можно: финализированные итоги (results_finalized_at)
    // ИЛИ проведённый акт (status='processed' — он залочен по умолчанию,
    // см. результат-страницу isLocked). Если ни то, ни другое — no-op.
    const isProcessed = document.status === "processed";
    if (!document.results_finalized_at && !isProcessed) return { error: null };

    // Условно: статус тот же, что прочитали, и финализация в том же
    // состоянии. Иначе переоткрытие, начатое до параллельной финализации,
    // снимало бы только что поставленный замок, а двойной клик писал бы два
    // события и дважды сторнировал удержание.
    const applied = await transitionDocumentStatus({
      admin,
      accountId: ctx.accountId,
      documentId: document.id,
      from: [document.status],
      finalized: document.results_finalized_at ? "finalized" : "open",
      patch: {
        results_finalized_at: null,
        results_finalized_by: null,
        results_reopened_at: new Date().toISOString(),
        results_reopened_by: ctx.user.id,
        // Устойчивый сигнал «итоги правились после проведения» — только когда
        // разблокируем УЖЕ проведённый акт (F6). Для обычного reopen на этапе
        // проверки (не processed) не ставим.
        ...(isProcessed ? { results_reopened_after_processed: true } : {}),
      },
    });
    if (!applied) return { error: DOCUMENT_CHANGED_ERROR };

    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: document.id,
      eventType: "results_reopened",
      message: isProcessed
        ? "Разблокировал проведённый акт для редактирования"
        : "Открыл итоги для редактирования",
      payload: { documentId: document.id, reason, processed: isProcessed },
    });

    // Переоткрытый акт больше не фиксирует итоги, на которых посчитано удержание:
    // строки месяца сторнируются (если стоят в зафиксированном периоде - явное
    // пояснение, итоги при этом уже переоткрыты).
    let notice: string | undefined;
    try {
      const reverted = await reverseInventoryDeductionForDocument({
        documentId: document.id,
        reason: `Итоги акта № ${document.document_number} переоткрыты: ${reason}`,
      });
      if (reverted.error)
        notice = `Итоги переоткрыты, но удержание по недостаче не сторнировано: ${reverted.error}`;
      else if (reverted.summary) notice = reverted.summary;
    } catch (e) {
      console.error("[reopen] сторно удержания не выполнено", { documentId: document.id, error: e });
      notice = "Итоги переоткрыты, но удержание по недостаче не сторнировано из-за ошибки.";
    }

    revalidateInventoryResultPages(document.id);
    return { error: null, ...(notice ? { notice } : {}) };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось переоткрыть итоги") };
  }
}
