"use server";

// Жизненный цикл акта: удаление, заметка, привязка склада к точке.

import { ACT_CREATING_LOCK_REASON } from "@/lib/inventory/act-creation-job";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { autoRecalculateInventoryDeduction } from "../deduction-service";
import { getCachedPermissionChecker } from "@/lib/supabase/server";
import { writeAuditEvent, writeAuditEvents } from "@/lib/audit/write";
import { isBackOfficePermissionError } from "@/lib/integrations/quickresto/auth-state";
import {
  readInventoryDocumentBackOffice,
  removeInventoryDocumentBackOffice,
  unprocessInventoryDocumentBackOffice,
  type QuickRestoInventoryDocument2,
} from "@/lib/integrations/quickresto/client";
import {
  deletedOnlyInQuickRestoMessage,
  processedNeedsConfirmMessage,
  quickRestoBusyMessage,
  unprocessedNotDeletedMessage,
  quickRestoActId,
  quickRestoDeleteFailedMessage,
  quickRestoDeleteStep,
  type QuickRestoDeleteOutcome,
} from "@/lib/inventory/act-delete";
import { countRu } from "@/lib/format/plural";
import { businessMonthOf } from "@/lib/stock/monthly-snapshot";
import { backOfficeTimeZoneParam } from "@/lib/inventory/act-date";
import {
  actionErrorMessage,
  assertDocumentVisible,
  filterVisibleDocumentIds,
  getActiveContext,
  dateText,
  getConnection,
  quickRestoUserError,
  text,
  withBackOfficeSession,
  type QuickRestoConnection,
  documentsBeingCreated,
} from "../actions-shared";

/**
 * Акт с утверждёнными итогами удалять нельзя: вместе со строкой documents
 * каскадом уходят снимок итогов, пересорты и журнал решений — вся
 * доказательная база по закрытой инвентаризации. Право
 * inventory.manage_documents такого разрешения не подразумевает.
 *
 * Проведённый акт без утверждённых итогов удалить можно, но только по одному
 * и с явным согласием: сначала проведение отменяется в Quick Resto (остатки
 * склада пересчитаются), потом акт удаляется. Массовое удаление проведённые
 * пропускает.
 *
 * Условие живёт в самом DELETE, а не только в предварительном SELECT: акт
 * могли зафиксировать между чтением и удалением. Сколько строк реально
 * удалено, DELETE сообщает сам — по нему и считаем пропущенные.
 */
const DELETE_BLOCKED_MESSAGE =
  "У акта утверждены итоги — удалить его нельзя: вместе с ним пропадут итоги, пересорты и журнал решений.";

const BULK_PROCESSED_MESSAGE =
  "Проведённые акты удаляются по одному — из меню «⋯» акта: сначала отменяется проведение в Quick Resto.";

/**
 * Удаление акта инвентаризации — у нас и в Quick Resto. Право
 * inventory.manage_documents.
 *
 * Порядок: сначала Quick Resto, потом у нас. Если Quick Resto удаление не
 * подтвердил, акт остаётся в обоих местах и пользователь видит причину:
 * удалить только у нас — значит получить акт обратно при следующей
 * синхронизации. Проведённый в Quick Resto акт не трогаем нигде. Удаление в
 * Quick Resto «мягкое» (`deleted: true`), синхронизация такие акты не
 * заводит заново — см. `src/lib/inventory/act-delete.ts`.
 *
 * У нас — полное delete с каскадом по FK (document_items → on delete cascade
 * из миграции 122).
 */
export async function deleteInventoryDocument(input: {
  documentId: string;
  /** Пользователь согласился отменить проведение (окно предупредило, что
   *  остатки склада пересчитаются). Без него проведённый акт не трогаем. */
  allowUnprocess?: boolean;
}): Promise<{ error: string | null; notice?: string }> {
  try {
    const ctx = await getActiveContext("inventory.manage_documents");
    if (ctx.error || !ctx.accountId) {
      return { error: ctx.error ?? "Не удалось определить контекст" };
    }
    const accountId = ctx.accountId;
    const admin = asLooseDb(createAdminClient());
    await assertDocumentVisible({ supabase: ctx.supabase, documentId: input.documentId });
    // Подключение — заранее: проверка акта ниже должна идти вплотную к
    // удалению в Quick Resto, без лишних запросов между ними.
    const connection = await getConnection(accountId);

    const { data: document, error: readError } = await admin
      .from<DeletableDocument>("documents")
      .select(DELETABLE_DOCUMENT_COLUMNS)
      .eq("id", input.documentId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (readError) return { error: actionErrorMessage(readError, "Не удалось удалить акт") };
    if (!document) return { error: "Акт не найден" };
    // До похода в Quick Resto: акт с утверждёнными итогами не удаляем и там.
    if (document.results_snapshot_at) return { error: DELETE_BLOCKED_MESSAGE };
    const allowUnprocess = input.allowUnprocess === true;
    if (document.status === "processed" && !allowUnprocess) {
      return { error: "Акт проведён. Чтобы удалить его, подтвердите отмену проведения в окне удаления." };
    }
    if ((await documentsBeingCreated(admin, accountId, [document.id])).size > 0) {
      return { error: ACT_CREATING_LOCK_REASON };
    }

    const quickResto = await removeFromQuickResto({ admin, connection, document, allowUnprocess });
    if ("error" in quickResto) return { error: quickResto.error };

    // Статус — тот же, что прочитали: акт, который за это время провели
    // или зафиксировали, не удаляем.
    const { data: deleted, error } = await admin
      .from<DeletedDocument[]>("documents")
      .delete()
      .eq("id", input.documentId)
      .eq("account_id", accountId)
      .eq("status", document.status)
      .is("results_snapshot_at", null)
      .select(DELETED_DOCUMENT_COLUMNS);
    if (error) return { error: actionErrorMessage(error, "Не удалось удалить акт") };
    // Ноль удалённых строк при видимом акте = сработало условие: акт успели
    // провести или зафиксировать между проверкой и удалением.
    if ((deleted ?? []).length === 0) {
      if (quickResto.outcome === "deleted" || quickResto.outcome === "unprocessed_and_deleted") {
        console.error("[deleteInventoryDocument] акт удалён в Quick Resto, но у нас его успели провести", {
          documentId: input.documentId,
        });
        return { error: deletedOnlyInQuickRestoMessage(document.document_number) };
      }
      return { error: DELETE_BLOCKED_MESSAGE };
    }
    if (ctx.user) {
      await logDeletedDocuments(admin, ctx, deleted ?? [], new Map([[input.documentId, quickResto.outcome]]));
    }
    revalidatePath("/documents/inventory");
    // Проведённый акт входил в удержания месяца — пересчитать (по умолчанию
    // выключено: INVENTORY_DEDUCTION_AUTOPOST). Удаление уже прошло и от
    // пересчёта не зависит.
    const notice = document.status === "processed" ? await recalculateDeductionsAfterDelete(admin, deleted ?? []) : null;
    return { error: null, ...(notice ? { notice } : {}) };
  } catch (e) {
    console.error("[deleteInventoryDocument] unhandled error:", e);
    return { error: actionErrorMessage(e, "Не удалось удалить акт. Подробности в логах.") };
  }
}

/**
 * Массовое удаление актов (из плавающего bulk-бара). Право
 * inventory.manage_documents. Как одиночное: каждый акт сначала в Quick
 * Resto, потом у нас; акт, который Quick Resto не удалил, остаётся.
 */
export async function bulkDeleteInventoryDocuments(input: {
  documentIds: string[];
}): Promise<{ deleted: number; error: string | null }> {
  try {
    const ctx = await getActiveContext("inventory.manage_documents");
    if (ctx.error || !ctx.accountId) {
      return { deleted: 0, error: ctx.error ?? "Не удалось определить контекст" };
    }
    const accountId = ctx.accountId;
    const ids = Array.from(new Set(input.documentIds)).filter(Boolean);
    if (ids.length === 0) return { deleted: 0, error: "Не выбрано ни одного акта" };

    const admin = asLooseDb(createAdminClient());
    // Массиву id с клиента не доверяем: оставляем только те акты, которые
    // пользователь реально видит (RLS documents_select).
    const visible = await filterVisibleDocumentIds({ supabase: ctx.supabase, documentIds: ids });
    const visibleIds = ids.filter((id) => visible.has(id));
    if (visibleIds.length === 0) return { deleted: 0, error: "Акты не найдены" };

    const connection = await getConnection(accountId);
    const { data: documents, error: readError } = await admin
      .from<DeletableDocument[]>("documents")
      .select(DELETABLE_DOCUMENT_COLUMNS)
      .eq("account_id", accountId)
      .in("id", visibleIds);
    if (readError) return { deleted: 0, error: actionErrorMessage(readError, "Не удалось удалить акты") };
    const creating = await documentsBeingCreated(admin, accountId, (documents ?? []).map((doc) => doc.id));
    const deletable = (documents ?? []).filter((doc) => isLocallyDeletable(doc) && !creating.has(doc.id));
    const blocked = visibleIds.length - deletable.length;
    const processedSkipped = (documents ?? []).some((doc) => doc.status === "processed" && !doc.results_snapshot_at);
    if (deletable.length === 0) {
      return { deleted: 0, error: processedSkipped ? BULK_PROCESSED_MESSAGE : DELETE_BLOCKED_MESSAGE };
    }

    // По одному: запросы к Quick Resto идут через общую очередь, и отказ по
    // одному акту не должен останавливать остальные.
    const outcomes = new Map<string, QuickRestoDeleteOutcome>();
    const failures: string[] = [];
    let blockedOnTheWay = 0;
    for (const document of deletable) {
      // Удаление в Quick Resto идёт по очереди и может занять время: перед
      // каждым актом — свежая проверка, что его не провели за это время.
      if (quickRestoActId(document.external_id) !== null) {
        const { data: fresh } = await admin
          .from<DeletableDocument>("documents")
          .select(DELETABLE_DOCUMENT_COLUMNS)
          .eq("id", document.id)
          .eq("account_id", accountId)
          .maybeSingle();
        if (!fresh || !isLocallyDeletable(fresh)) {
          blockedOnTheWay += 1;
          continue;
        }
      }
      const result = await removeFromQuickResto({ admin, connection, document, allowUnprocess: false });
      if ("error" in result) failures.push(result.error);
      else outcomes.set(document.id, result.outcome);
    }

    const readyIds = Array.from(outcomes.keys());
    let deletedRows: DeletedDocument[] = [];
    if (readyIds.length > 0) {
      const { data, error } = await admin
        .from<DeletedDocument[]>("documents")
        .delete()
        .eq("account_id", accountId)
        .in("id", readyIds)
        .neq("status", "processed")
        .is("results_snapshot_at", null)
        .select(DELETED_DOCUMENT_COLUMNS);
      if (error) return { deleted: 0, error: actionErrorMessage(error, "Не удалось удалить акты") };
      deletedRows = data ?? [];
    }
    if (ctx.user) await logDeletedDocuments(admin, ctx, deletedRows, outcomes);
    if (deletedRows.length > 0) revalidatePath("/documents/inventory");

    const notes: string[] = [];
    const deletedIds = new Set(deletedRows.map((row) => row.id));
    const lateBlocked = deletable.filter((doc) => outcomes.has(doc.id) && !deletedIds.has(doc.id));
    const skipped = blocked + blockedOnTheWay + lateBlocked.length;
    if (skipped > 0) {
      notes.push(
        `Пропущено актов: ${skipped}. ${processedSkipped ? BULK_PROCESSED_MESSAGE : DELETE_BLOCKED_MESSAGE}`,
      );
    }
    for (const doc of lateBlocked) {
      const outcome = outcomes.get(doc.id);
      if (outcome !== "deleted" && outcome !== "unprocessed_and_deleted") continue;
      console.error("[bulkDeleteInventoryDocuments] акт удалён в Quick Resto, но у нас его успели провести", {
        documentId: doc.id,
      });
      notes.push(deletedOnlyInQuickRestoMessage(doc.document_number));
    }
    if (failures.length === 1) notes.push(failures[0]);
    if (failures.length > 1) {
      notes.push(
        `Quick Resto не удалил ${countRu(failures.length, "акт", "акта", "актов")} — у нас они тоже остались. ${failures[0]}`,
      );
    }
    return { deleted: deletedRows.length, error: notes.length > 0 ? notes.join(" ") : null };
  } catch (e) {
    console.error("[bulkDeleteInventoryDocuments] unhandled error:", e);
    return { deleted: 0, error: actionErrorMessage(e, "Не удалось удалить акты. Подробности в логах.") };
  }
}

const DELETABLE_DOCUMENT_COLUMNS = "id, external_id, document_number, status, results_snapshot_at, venue_id";

type DeletableDocument = {
  id: string;
  external_id: string | null;
  document_number: string | null;
  status: string;
  results_snapshot_at: string | null;
  venue_id: string | null;
};

function isLocallyDeletable(document: DeletableDocument): boolean {
  return document.status !== "processed" && !document.results_snapshot_at;
}

/** Сколько ждать, пока Quick Resto закончит отмену проведения (CANCELLING). */
const UNPROCESS_WAIT_STEPS_MS = [500, 1_000, 1_000, 2_000, 2_000, 3_000, 3_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Удалить акт в Quick Resto (если он оттуда). Проведённый — только с
 * `allowUnprocess`: сначала отмена проведения, ожидание, пока Quick Resto её
 * закончит, сверка перечитыванием и только потом удаление. Ошибка — русским
 * текстом для пользователя; английский ответ Quick Resto — только в лог.
 */
async function removeFromQuickResto(input: {
  admin: ReturnType<typeof asLooseDb>;
  connection: QuickRestoConnection | null;
  document: DeletableDocument;
  allowUnprocess: boolean;
}): Promise<{ outcome: QuickRestoDeleteOutcome } | { error: string }> {
  const externalId = quickRestoActId(input.document.external_id);
  if (externalId === null) return { outcome: "not_linked" };
  const number = input.document.document_number;
  const connection = input.connection;
  if (!connection) {
    return { error: `${quickRestoDeleteFailedMessage(number)} Подключение к Quick Resto не настроено.` };
  }
  let unprocessed = false;
  const timeZone = (await venueTimeZone(input.admin, input.document.venue_id)) ?? DEFAULT_TIME_ZONE;
  try {
    const result = await withBackOfficeSession({
      connection,
      admin: input.admin,
      // Сбой сети — повтор целиком: чтение заново (уже распроведённый акт
      // прочитается как непроведённый), удаление повторять безопасно.
      retryTransient: true,
      run: async (authorization) => {
        const qrAuth = { layerName: connection.login, baseUrl: connection.backoffice_base_url, authorization };
        const read = () => readInventoryDocumentBackOffice({ ...qrAuth, id: externalId });
        let current = await read();
        let step = quickRestoDeleteStep(current, externalId);
        if (step === "unprocess") {
          if (!input.allowUnprocess) return { step: "needs_confirm" as const };
          const at = Date.parse(dateText(current.invoiceDate) ?? "");
          await unprocessInventoryDocumentBackOffice({
            ...qrAuth,
            documentId: externalId,
            timeZoneOffset: backOfficeTimeZoneParam(Number.isFinite(at) ? at : Date.now(), timeZone),
          });
          unprocessed = true;
          step = "busy";
        }
        // Отмена проведения идёт в Quick Resto не мгновенно (CANCELLING):
        // ждём, пока акт перечитается непроведённым.
        if (step === "busy" && unprocessed) {
          for (const wait of UNPROCESS_WAIT_STEPS_MS) {
            await sleep(wait);
            current = await read();
            step = quickRestoDeleteStep(current, externalId);
            if (step !== "busy") break;
          }
        }
        if (step === "remove") {
          await removeInventoryDocumentBackOffice({
            ...qrAuth,
            document: current as unknown as QuickRestoInventoryDocument2,
          });
        }
        return { step };
      },
    });
    const step = result.step;
    if (step === "needs_confirm") return { error: processedNeedsConfirmMessage(number) };
    if (step === "busy") {
      return { error: unprocessed ? unprocessedNotDeletedMessage(number) : quickRestoBusyMessage(number) };
    }
    if (step === "unknown" || step === "unprocess") {
      console.error("[deleteInventoryDocument] Quick Resto не сказал, проведён ли акт", { externalId, step });
      return { error: unprocessed ? unprocessedNotDeletedMessage(number) : quickRestoDeleteFailedMessage(number) };
    }
    if (step === "remove") return { outcome: unprocessed ? "unprocessed_and_deleted" : "deleted" };
    return { outcome: step };
  } catch (error) {
    console.error("[deleteInventoryDocument] Quick Resto не удалил акт", { externalId, unprocessed, error });
    if (unprocessed) return { error: unprocessedNotDeletedMessage(number) };
    if (isBackOfficePermissionError(error)) {
      return {
        error: "У пользователя Sheerly Bot в Quick Resto нет прав удалять акты инвентаризации или отменять их проведение.",
      };
    }
    return { error: quickRestoUserError(error, quickRestoDeleteFailedMessage(number)) };
  }
}

const DEFAULT_TIME_ZONE = "Europe/Moscow";

async function venueTimeZone(admin: ReturnType<typeof asLooseDb>, venueId: string | null): Promise<string | null> {
  if (!venueId) return null;
  const { data } = await admin
    .from<{ timezone: string | null }>("venues")
    .select("timezone")
    .eq("id", venueId)
    .maybeSingle();
  return data?.timezone ?? null;
}

/** Удержания месяца удалённого проведённого акта — пересчитать. */
async function recalculateDeductionsAfterDelete(
  admin: ReturnType<typeof asLooseDb>,
  rows: DeletedDocument[],
): Promise<string | null> {
  try {
    const items: Array<{ venueId: string; month: string }> = [];
    for (const row of rows) {
      if (!row.venue_id || !row.invoice_date) continue;
      const { data: venue } = await admin
        .from<{ timezone: string | null }>("venues")
        .select("timezone")
        .eq("id", row.venue_id)
        .maybeSingle();
      if (!venue?.timezone) continue;
      items.push({ venueId: row.venue_id, month: `${businessMonthOf(row.invoice_date, venue.timezone)}-01` });
    }
    if (items.length === 0) return null;
    return await autoRecalculateInventoryDeduction({ kind: "months", items });
  } catch (error) {
    console.error("[deleteInventoryDocument] удержания не пересчитаны", error);
    return null;
  }
}

/**
 * Общий комментарий к акту (таб «Основное»). Локальное поле documents.note,
 * sync его не трогает. Редактировать может управляющий актами
 * (`inventory.manage_documents`), назначенный исполнитель или проверяющий —
 * остальным поле read-only.
 */
export async function updateInventoryDocumentNote(input: {
  documentId: string;
  note: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext();
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error ?? "Ошибка" };

  const admin = asLooseDb(createAdminClient());
  try {
    await assertDocumentVisible({ supabase: ctx.supabase, documentId: input.documentId });
    const { data: document } = await admin
      .from<{
        id: string;
        assigned_to: string | null;
        reviewer_id: string | null;
        archived_at: string | null;
        note: string | null;
        document_number: string | null;
        invoice_date: string | null;
        venue_id: string | null;
      }>("documents")
      .select("id, assigned_to, reviewer_id, archived_at, note, document_number, invoice_date, venue_id")
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!document?.id) throw new Error("Акт не найден");
    if (document.archived_at) throw new Error("Этот акт удалён в Quick Resto и недоступен для изменений.");

    const can = await getCachedPermissionChecker();
    const canEdit =
      can("inventory.manage_documents") ||
      document.assigned_to === ctx.user.id ||
      (document.reviewer_id === ctx.user.id && can("inventory.recount_documents"));
    if (!canEdit) throw new Error("Недостаточно прав для редактирования комментария");

    const note = text(input.note);
    if ((document.note ?? null) === (note ?? null)) return { error: null };
    const { error } = await admin
      .from("documents")
      .update({ note })
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId);
    if (error) throw new Error(error.message);

    await writeAuditEvent({
      accountId: ctx.accountId,
      venueId: document.venue_id ?? ctx.venueId,
      userId: ctx.user.id,
      actionCode: "inventory.document_note_updated",
      entityType: "inventory_document",
      entityId: input.documentId,
      details: {
        number: document.document_number,
        date: document.invoice_date,
        changes: [{ field: "note", old: document.note, new: note }],
      },
    });

    revalidatePath(`/documents/inventory/${input.documentId}/overview`);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось сохранить комментарий") };
  }
}

export async function updateInventoryStoreVenue(input: {
  storeId: string;
  venueId: string | null;
}): Promise<{ error: string | null; notice?: string }> {
  const ctx = await getActiveContext("inventory.manage_stores");
  if (ctx.error || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  // venueId приходит с клиента: без проверки склад (а за ним, через триггер
  // миграции 194, и все его акты) уезжал в заведение чужого аккаунта.
  if (input.venueId) {
    const { data: venue } = await admin
      .from<{ id: string }>("venues")
      .select("id")
      .eq("id", input.venueId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!venue?.id) return { error: "Заведение не найдено" };
  }

  // Прежнее заведение: после смены удержания надо пересчитать и в нём (акты склада из него ушли).
  const { data: before } = await admin
    .from<{ local_venue_id: string | null; title: string | null }>("stores")
    .select("local_venue_id, title")
    .eq("id", input.storeId)
    .eq("account_id", ctx.accountId)
    .maybeSingle();

  // RPC клиентом пользователя (миграция 365), а не UPDATE service-role'ом:
  // журнал событий пишет автора смены заведения из auth.uid().
  const { error } = await asLooseDb(ctx.supabase).rpc("set_store_venue", {
    p_store_id: input.storeId,
    p_venue_id: input.venueId || null,
  });

  if (error) {
    console.error("[stores] venue update failed", error);
    // Отказы RPC написаны для пользователя («Заведение в архиве…»), прочее — технические.
    return { error: (error as { code?: string }).code === "P0001" ? error.message : "Не удалось сохранить заведение склада. Повторите попытку" };
  }

  // Событие store.venue_changed в общий журнал пишет триггер stores_audit_trigger
  // (миграция 365) с автором из auth.uid(): он же ловит смену заведения не из
  // этого экрана (удаление заведения). Писать его ещё и отсюда — дубль.

  // Пропагация venue в documents.venue_id — на уровне БД (триггер
  // trg_stores_propagate_venue_to_documents, миграция 194), атомарно
  // в той же транзакции UPDATE stores. Второй write из app не нужен.

  // Привязка к заведению решает, чьё удержание платит за акты склада: пересчитываются месяцы
  // и прежнего, и нового заведения. Выключено по умолчанию (INVENTORY_DEDUCTION_AUTOPOST);
  // привязка уже сохранена и от пересчёта не зависит.
  const notice = await autoRecalculateInventoryDeduction({
    kind: "store-venue",
    storeId: input.storeId,
    venueIds: [before?.local_venue_id ?? null, input.venueId || null],
  });

  revalidatePath("/org/stores");
  return { error: null, ...(notice ? { notice } : {}) };
}

/**
 * Привязка склада к подразделению: «Не задано» / «Общий склад» / конкретное
 * подразделение. От выбора зависит, кто платит за недостачу по складу, поэтому
 * «не задано» — отдельное состояние, а не отсутствие значения.
 *
 * Подразделения принадлежат заведению (departments.venue_id), а не аккаунту:
 * у склада без заведения подразделения быть не может, а у склада с заведением —
 * только из него. Эти два правила держит и база (триггер миграции 307), но
 * проверяем здесь тоже: во-первых, чтобы не показать пользователю сырой текст
 * исключения, во-вторых, как и в updateInventoryStoreVenue, чтобы id с клиента
 * не привёл к подразделению чужого аккаунта.
 */
export async function updateInventoryStoreDepartment(input: {
  storeId: string;
  scope: "unset" | "shared" | "department";
  departmentId: string | null;
}): Promise<{ error: string | null; notice?: string }> {
  try {
    const ctx = await getActiveContext("inventory.manage_stores");
    if (ctx.error || !ctx.accountId) return { error: ctx.error ?? "Не удалось определить контекст" };

    if (!["unset", "shared", "department"].includes(input.scope)) {
      return { error: "Неизвестный вариант привязки" };
    }
    if ((input.scope === "department") !== Boolean(input.departmentId)) {
      return { error: "Подразделение указывается только для варианта «Подразделение»" };
    }

    const admin = asLooseDb(createAdminClient());
    if (input.departmentId) {
      // У departments нет account_id (миграция 172): аккаунт — через заведение.
      // Склад читаем тем же запросом в рамках аккаунта, чтобы сверить заведения.
      const { data: store } = await admin
        .from<{ id: string; local_venue_id: string | null }>("stores")
        .select("id, local_venue_id")
        .eq("id", input.storeId)
        .eq("account_id", ctx.accountId)
        .maybeSingle();
      if (!store?.id) return { error: "Склад не найден" };
      if (!store.local_venue_id) {
        return { error: "Сначала привяжите склад к заведению: подразделение выбирается из его подразделений" };
      }

      const { data: department } = await admin
        .from<{ id: string; venue_id: string; archived_at: string | null }>("departments")
        .select("id, venue_id, archived_at")
        .eq("id", input.departmentId)
        .maybeSingle();
      if (!department?.id) return { error: "Подразделение не найдено" };
      if (department.archived_at) return { error: "Подразделение в архиве: выберите другое" };
      const { data: venue } = await admin
        .from<{ id: string }>("venues")
        .select("id")
        .eq("id", department.venue_id)
        .eq("account_id", ctx.accountId)
        .maybeSingle();
      if (!venue?.id) return { error: "Подразделение не найдено" };
      if (department.venue_id !== store.local_venue_id) {
        return { error: "Подразделение относится к другому заведению, не к заведению склада" };
      }
    }

    // RPC, а не прямой UPDATE: authenticated не имеет права писать в stores, а
    // история изменений привязки пишется триггером от имени вызывающего
    // (auth.uid()), поэтому вызываем клиентом пользователя, не service-role.
    const { data: storeBefore } = await admin
      .from<{
        title: string | null;
        local_venue_id: string | null;
        department_scope: string | null;
        department_id: string | null;
      }>("stores")
      .select("title, local_venue_id, department_scope, department_id")
      .eq("id", input.storeId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    const { error } = await asLooseDb(ctx.supabase).rpc("set_store_department", {
      p_store_id: input.storeId,
      p_scope: input.scope,
      p_department_id: input.departmentId || null,
    });
    if (error) return { error: actionErrorMessage(error, "Не удалось сохранить привязку склада") };

    if (
      ctx.user &&
      storeBefore &&
      (storeBefore.department_scope !== input.scope ||
        (storeBefore.department_id ?? null) !== (input.departmentId || null))
    ) {
      let departmentName: string | null = null;
      if (input.departmentId) {
        const { data: department } = await admin
          .from<{ name: string | null }>("departments")
          .select("name")
          .eq("id", input.departmentId)
          .maybeSingle();
        departmentName = department?.name ?? null;
      }
      await writeAuditEvent({
        accountId: ctx.accountId,
        venueId: storeBefore.local_venue_id ?? ctx.venueId,
        userId: ctx.user.id,
        actionCode: "store.department_changed",
        entityType: "store",
        entityId: input.storeId,
        details: {
          title: storeBefore.title,
          old_scope: storeBefore.department_scope,
          new_scope: input.scope,
          new_department_name: departmentName,
        },
      });
    }

    // Привязка склада меняет плательщика в месяцах его актов. Выключено по умолчанию
    // (INVENTORY_DEDUCTION_AUTOPOST); привязка уже сохранена и от пересчёта не зависит.
    const notice = await autoRecalculateInventoryDeduction({ kind: "store", storeId: input.storeId });

    revalidatePath("/org/stores");
    return { error: null, ...(notice ? { notice } : {}) };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось сохранить привязку склада") };
  }
}

const DELETED_DOCUMENT_COLUMNS =
  "id, document_number, invoice_date, venue_id, store:stores(title)";

type DeletedDocument = {
  id: string;
  document_number: string | null;
  invoice_date: string | null;
  venue_id: string | null;
  store: { title: string | null } | Array<{ title: string | null }> | null;
};

/** Удалённый акт уносит каскадом и свой журнал решений, поэтому след
 *  остаётся только в общем журнале: номер, дата и склад на момент удаления. */
async function logDeletedDocuments(
  admin: ReturnType<typeof asLooseDb>,
  ctx: { accountId: string | null; venueId: string | null; user: { id: string } | null },
  rows: DeletedDocument[],
  quickResto: ReadonlyMap<string, QuickRestoDeleteOutcome> = new Map(),
) {
  const { accountId, user } = ctx;
  if (!accountId || !user) return;
  await writeAuditEvents(
    rows.map((row) => {
      const store = Array.isArray(row.store) ? row.store[0] : row.store;
      return {
        accountId,
        venueId: row.venue_id ?? ctx.venueId,
        userId: user.id,
        actionCode: "inventory.document_deleted",
        entityType: "inventory_document",
        entityId: row.id,
        details: {
          number: row.document_number,
          date: row.invoice_date,
          store_title: store?.title ?? null,
          quickresto: quickResto.get(row.id) ?? null,
        },
      };
    }),
  );
}
