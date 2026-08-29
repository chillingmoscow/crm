"use server";

// Форма акта: начало заполнения и отправка факта в Quick Resto.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { isInventoryFormLocked } from "@/lib/inventory/act-status";
import { pluralRu } from "@/lib/format/plural";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import {
  readInventoryDocument,
  updateInventoryItemBackOffice,
  type QuickRestoInventoryDocument2
} from "@/lib/integrations/quickresto/client";
import {
  type InventoryProductLookup,
  actionErrorMessage,
  amountsEqual,
  assertDocumentVisible,
  connectionPassword,
  dateText,
  externalItemId,
  extractLineResult,
  getActiveContext,
  getConnection,
  inventoryDocumentItems,
  listBackOfficeInventoryItemsWithSession,
  notifyInventoryDocumentEvent,
  num,
  quickRestoDocumentSums,
  readActualAmountsByExternalItemId,
  sameDate,
  syncDocumentItems,
  withBackOfficeSession,
  writeInventoryResultEvent
} from "../actions-shared";

/**
 * Сколько построчных запросов к backoffice Quick Resto держим одновременно.
 * Последовательный цикл упирался в latency (акт на 300 позиций — минуты),
 * Promise.all по всему акту завалил бы и QR, и пул соединений. Держим
 * умеренно: каждый воркер при протухшем cookie может пойти за новым.
 */
const QR_ITEM_CONCURRENCY = 5;

/**
 * Помечает, что исполнитель начал заполнять акт: переводит
 * assigned/synced → in_progress на первом сохранённом черновике
 * (черновик живёт в IndexedDB на клиенте, серверного сигнала нет — этот
 * мост его создаёт). Идемпотентно и best-effort: вызывается из autosave
 * формы, дальше по статусной машине ничего не двигает.
 */
export async function markInventoryDraftStarted(input: {
  documentId: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext();
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  // Permission-гейт зеркалит submitInventoryDocumentDraft: двигать статус
  // может тот, кто реально заполняет акт — менеджер или назначенный
  // исполнитель с правом «Заполнять назначенные акты». Иначе любой
  // авторизованный пользователь мог бы дёрнуть action напрямую.
  const [{ data: canManage }, { data: canFill }] = await Promise.all([
    ctx.supabase.rpc("has_permission", { permission_code: "inventory.manage_documents" }),
    ctx.supabase.rpc("has_permission", { permission_code: "inventory.fill_assigned_documents" }),
  ]);

  const admin = asLooseDb(createAdminClient());
  try {
    await assertDocumentVisible({ supabase: ctx.supabase, documentId: input.documentId });
    const { data: document } = await admin
      .from<{ id: string; status: string; assigned_to: string | null; archived_at: string | null }>("documents")
      .select("id, status, assigned_to, archived_at")
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    // best-effort: молча выходим, если акта нет / переводить нечего /
    // дёргает не назначенный исполнитель / нет права заполнять / акт удалён
    // в QR (архивный).
    if (!document?.id) return { error: null };
    if (document.archived_at) return { error: null };
    if (document.assigned_to !== ctx.user.id) return { error: null };
    const allowed = Boolean(canManage) || Boolean(canFill);
    if (!allowed) return { error: null };
    if (document.status !== "assigned" && document.status !== "synced") return { error: null };

    const { error } = await admin
      .from("documents")
      .update({ status: "in_progress" })
      .eq("id", document.id)
      .eq("account_id", ctx.accountId)
      // guard от гонки: апдейтим, только пока статус ещё «не начат».
      .in("status", ["assigned", "synced"]);
    if (error) throw new Error(error.message);

    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: document.id,
      eventType: "draft_started",
      message: "Начал заполнять акт",
    });

    revalidatePath("/documents/inventory");
    revalidatePath(`/documents/inventory/${document.id}`);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось обновить статус акта") };
  }
}

export async function submitInventoryDocumentDraft(input: {
  documentId: string;
  baseLastUpdateDate: string | null;
  items: Array<{ itemId: string; actualAmount: number | null }>;
}): Promise<{ resultsHasLineAmounts: boolean; refreshDocument?: boolean; error: string | null }> {
  const ctx = await getActiveContext();
  if (ctx.error || !ctx.user || !ctx.accountId) {
    return { resultsHasLineAmounts: false, error: ctx.error };
  }

  const [{ data: canManage }, { data: canFill }] = await Promise.all([
    ctx.supabase.rpc("has_permission", { permission_code: "inventory.manage_documents" }),
    ctx.supabase.rpc("has_permission", { permission_code: "inventory.fill_assigned_documents" }),
  ]);

  const admin = asLooseDb(createAdminClient());
  try {
    await assertDocumentVisible({ supabase: ctx.supabase, documentId: input.documentId });
  } catch (visibilityError) {
    return {
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
      reviewer_id: string | null;
      document_number: string;
      venue_id: string | null;
      processed: boolean;
      status: string;
      results_finalized_at: string | null;
      base_last_update_date: string | null;
      archived_at: string | null;
    }>("documents")
    .select(
      "id, account_id, external_id, assigned_to, reviewer_id, document_number, venue_id, processed, status, results_finalized_at, base_last_update_date, archived_at",
    )
    .eq("id", input.documentId)
    .eq("account_id", ctx.accountId)
    .maybeSingle();

  if (!document?.id) return { resultsHasLineAmounts: false, error: "Акт не найден" };
  // Акт удалён в Quick Resto (авто-архив) — отправлять нечего.
  if (document.archived_at) {
    return { resultsHasLineAmounts: false, error: "Этот акт удалён в Quick Resto и недоступен." };
  }
  const allowed = Boolean(canManage) || (Boolean(canFill) && document.assigned_to === ctx.user.id);
  if (!allowed) return { resultsHasLineAmounts: false, error: "Недостаточно прав" };
  if (document.processed) return { resultsHasLineAmounts: false, error: "Акт уже проведен в Quick Resto" };
  // Заполнение закрыто, когда акт уже ушёл на проверку / финализирован /
  // не синкнулся (статусная машина). recount_pending — НЕ заблокирован
  // (легитимный перерасчёт исполнителем).
  if (isInventoryFormLocked(document.status, Boolean(document.results_finalized_at))) {
    return {
      resultsHasLineAmounts: false,
      error: "Акт уже отправлен на проверку — заполнение закрыто.",
    };
  }

  const connection = await getConnection(ctx.accountId);
  if (!connection) return { resultsHasLineAmounts: false, error: "Активное подключение Quick Resto не найдено" };

  try {
    const password = connectionPassword(connection);
    const auth = { layerName: connection.login, login: connection.login, password };
    const fresh = await readInventoryDocument({ ...auth, objectId: Number(document.external_id) });

    if (fresh.processed) return { resultsHasLineAmounts: false, error: "Акт уже проведен в Quick Resto" };
    if (!sameDate(fresh.lastUpdateDate ?? null, input.baseLastUpdateDate ?? document.base_last_update_date ?? null)) {
      const freshItemsPreview = inventoryDocumentItems(fresh);
      const precheckHasResults = freshItemsPreview.items.some((item) => extractLineResult(item).hasResult);
      await admin
        .from("documents")
        .update({
          processed: Boolean(fresh.processed),
          base_last_update_date: dateText(fresh.lastUpdateDate),
          last_qr_update_date: dateText(fresh.lastUpdateDate),
          ...quickRestoDocumentSums(fresh),
          results_has_line_amounts: precheckHasResults,
          qr_payload: fresh,
          synced_at: new Date().toISOString(),
        })
        .eq("id", document.id)
        .eq("account_id", ctx.accountId);

      revalidatePath("/documents/inventory");
      revalidatePath(`/documents/inventory/${document.id}`);
      revalidatePath(`/documents/inventory/${document.id}/results`);
      return {
        resultsHasLineAmounts: false,
        refreshDocument: true,
        error: "Акт изменился в Quick Resto. Я обновил локальную версию; проверьте черновик и отправьте еще раз.",
      };
    }

    type LocalItemRow = {
      id: string;
      external_item_id: string;
      needs_recount: boolean | null;
      recount_previous_amount: number | null;
    };
    const localItemsResult = await admin
      .from<LocalItemRow[]>("document_items")
      .select("id, external_item_id, needs_recount, recount_previous_amount")
      .eq("document_id", document.id);
    const localItems = (localItemsResult.data ?? []) as LocalItemRow[];
    const localItemById = new Map(localItems.map((item) => [item.id, item]));

    // Пересчёт касается ТОЛЬКО отмеченных строк. Остальные исполнитель в этом
    // режиме и не редактирует (форма их блокирует), поэтому отправлять их в
    // Quick Resto незачем: на акте в 300 позиций это 300 запросов к backoffice
    // вместо четырёх, и каждый — лишний шанс словить таймаут. Фильтруем на
    // сервере, а не только в форме: клиент мог остаться на старой сборке.
    //
    // В границу круга берём не только текущие отметки, но и строки, которые
    // когда-либо уходили на пересчёт (recount_previous_amount, миграция 218).
    // Миграция 228 запрещает автомаркеру снимать пометки, пока акт на
    // пересчёте, но на данных, записанных до неё, отметки могли уже исчезнуть —
    // и без второго признака здесь открывался бы полный акт: ровно то, что
    // этот фильтр и должен предотвращать.
    const isRecountSubmit = document.status === "recount_pending";
    const recountScopeIds = new Set(
      localItems
        .filter((item) => item.needs_recount || item.recount_previous_amount != null)
        .map((item) => item.id),
    );
    const submittedItems =
      isRecountSubmit && recountScopeIds.size > 0
        ? input.items.filter((item) => recountScopeIds.has(item.itemId))
        : input.items;

    const nextAmounts = new Map<string, number>();
    for (const item of submittedItems) {
      const local = localItemById.get(item.itemId);
      if (!local) continue;
      if (item.actualAmount === null || !Number.isFinite(item.actualAmount) || item.actualAmount < 0) {
        return { resultsHasLineAmounts: false, error: "Проверьте фактические значения: есть некорректное число." };
      }
      nextAmounts.set(local.external_item_id, item.actualAmount);
    }
    if (nextAmounts.size === 0) {
      return {
        resultsHasLineAmounts: false,
        error: isRecountSubmit && recountScopeIds.size > 0
          ? "Заполните пересчитанные значения по отмеченным строкам"
          : "Заполните хотя бы одну позицию акта",
      };
    }

    const freshItemsPreview = inventoryDocumentItems(fresh);
    const freshItemByExternalId = new Map(
      freshItemsPreview.items.map((item, index) => [externalItemId(item, index), item])
    );
    const updateRows = Array.from(nextAmounts.entries()).map(([externalId, actualAmount]) => {
      const item = freshItemByExternalId.get(externalId);
      if (!item) {
        throw new Error(`Позиция акта ${externalId} не найдена в свежем payload Quick Resto`);
      }
      if (typeof item.id !== "number" && typeof item.id !== "string") {
        throw new Error(`Quick Resto не вернул ID строки для позиции ${externalId}`);
      }
      return { externalId, actualAmount, item };
    });

    const documentExternalId = Number(document.external_id);
    if (!Number.isFinite(documentExternalId)) {
      return { resultsHasLineAmounts: false, error: "У акта некорректный ID Quick Resto" };
    }

    // Отправляем в Quick Resto ТОЛЬКО строки, значение которых реально
    // меняется. Раньше уходил весь акт: на 300 позициях это 300
    // последовательных запросов к backoffice (каждый с таймаутом 20 с) —
    // 1–2 минуты в одном server action, и прокси успевал оборвать соединение,
    // оставив значения применёнными наполовину. Строка, где QR уже держит
    // нужное число, — это no-op, её достаточно проверить постусловием ниже.
    const rowsToSend = updateRows.filter(
      (row) => !amountsEqual(num(row.item.actualAmount), row.actualAmount),
    );
    const skippedUnchanged = updateRows.length - rowsToSend.length;

    // Параллелим пачками: последовательный цикл упирался в latency backoffice,
    // а Promise.all по всему акту завалил бы и QR, и пул соединений.
    // withBackOfficeSession даёт auth-ретрай на КАЖДУЮ строку отдельно —
    // раньше протухший cookie перезапускал весь цикл с нуля, повторно
    // отправляя уже применённые строки.
    await runWithConcurrency(rowsToSend, QR_ITEM_CONCURRENCY, async (row) => {
      await withBackOfficeSession({
        connection,
        admin,
        run: (cookieHeader) =>
          updateInventoryItemBackOffice({
            layerName: connection.login,
            baseUrl: connection.backoffice_base_url,
            cookieHeader,
            documentId: documentExternalId,
            item: row.item,
            actualAmount: row.actualAmount,
          }),
      });
    });
    if (skippedUnchanged > 0) {
      console.info(
        `[submitInventoryDocumentDraft] doc ${document.id}: отправлено ${rowsToSend.length} строк, пропущено без изменений ${skippedUnchanged}`,
      );
    }

    const [reread, backOfficeItems] = await Promise.all([
      readInventoryDocument({ ...auth, objectId: fresh.id }),
      listBackOfficeInventoryItemsWithSession({
        connection,
        admin,
        documentExternalId,
      }),
    ]);
    const actualAmountsByExternalId = readActualAmountsByExternalItemId(backOfficeItems);
    const notApplied = Array.from(nextAmounts.entries()).filter(([externalId, expected]) => (
      !amountsEqual(actualAmountsByExternalId.get(externalId), expected)
    ));
    if (notApplied.length > 0) {
      return {
        resultsHasLineAmounts: false,
        error: "Quick Resto принял запрос, но не применил фактические значения строк. Акт не отмечен отправленным.",
      };
    }

    const productRows = await admin
      .from<InventoryProductLookup[]>("ingredients")
      .select("id, external_id, article, barcode")
      .eq("account_id", ctx.accountId);
    const productByExternalId = new Map(
      ((productRows.data ?? []) as InventoryProductLookup[]).map((row) => [String(row.external_id), row])
    );

    // Recount cleanup: сбрасываем recount-флаги (и авто-, и ручные) на
    // строках, по которым исполнитель только что отправил новое значение.
    // Триггер `inventory_apply_recount_threshold` на следующем upsert
    // в syncDocumentItems заново проверит порог — если новое расхождение
    // тоже > threshold, флаг встанет автоматически. Делаем точечный UPDATE
    // без обновления columns-of-interest для триггера, чтобы не было
    // двойного срабатывания.
    const submittedItemIds = submittedItems.map((item) => item.itemId);
    if (submittedItemIds.length > 0) {
      await admin
        .from("document_items")
        .update({
          needs_recount: false,
          recount_auto_flagged: false,
          recount_marked_by: null,
          recount_marked_at: null,
          recount_note: null,
        })
        .eq("document_id", document.id)
        .eq("account_id", ctx.accountId)
        .in("id", submittedItemIds);
    }

    const syncResult = await syncDocumentItems({
      admin,
      accountId: ctx.accountId,
      documentId: document.id,
      items: backOfficeItems,
      productByExternalId,
      submittedAmounts: nextAmounts,
    });
    const rereadWithRows: QuickRestoInventoryDocument2 = {
      ...reread,
      effectedItems: backOfficeItems,
    };

    const nextStatus = syncResult.resultsFound ? "ready_for_review" : "results_blocked";
    const { error: updateLocalError } = await admin
      .from("documents")
      .update({
        status: nextStatus,
        processed: Boolean(reread.processed),
        base_last_update_date: dateText(reread.lastUpdateDate),
        last_qr_update_date: dateText(reread.lastUpdateDate),
        ...quickRestoDocumentSums(reread),
        results_has_line_amounts: syncResult.resultsFound,
        qr_payload: rereadWithRows,
        submitted_at: new Date().toISOString(),
        submitted_by: ctx.user.id,
        synced_at: new Date().toISOString(),
      })
      .eq("id", document.id)
      .eq("account_id", ctx.accountId);

    if (updateLocalError) return { resultsHasLineAmounts: false, error: updateLocalError.message };

    // Журнал: исполнитель завершил акт. Различаем первое заполнение и
    // завершение пересчёта по пред-статусу.
    const wasRecount = isRecountSubmit;
    // Сколько отмеченных строк вернулись с тем же числом. Это законный исход
    // («пересчитали, значение подтвердилось»), но проверяющий должен видеть
    // его явно: раньше «было 3 → стало 3» ничем не отличалось от акта, где
    // пересчёт не делали вовсе.
    const unchangedItems = wasRecount
      ? submittedItems.filter((item) => {
          const local = localItemById.get(item.itemId);
          if (!local || local.recount_previous_amount == null) return false;
          return amountsEqual(local.recount_previous_amount, item.actualAmount ?? undefined);
        })
      : [];
    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: document.id,
      eventType: "submitted",
      message: wasRecount
        ? unchangedItems.length > 0
          ? `Завершил пересчёт (${unchangedItems.length} из ${submittedItems.length} ${pluralRu(unchangedItems.length, "позиция", "позиции", "позиций")} без изменений)`
          : "Завершил пересчёт"
        : syncResult.resultsFound
          ? "Завершил заполнение акта"
          : "Завершил акт (итоги требуют проверки)",
      payload: {
        resultsFound: syncResult.resultsFound,
        recount: wasRecount,
        ...(wasRecount
          ? {
              recountedItemIds: submittedItemIds,
              unchangedItemIds: unchangedItems.map((item) => item.itemId),
            }
          : {}),
      },
    });

    // Уведомляем проверяющего: акт готов к проверке. Одна точка покрывает
    // и первое «Завершить», и «Завершить пересчёт». Если reviewer_id ещё не
    // назначен — notifyInventoryDocumentEvent тихо пропустит.
    await notifyInventoryDocumentEvent({
      admin,
      recipientId: document.reviewer_id,
      actorId: ctx.user.id,
      venueId: document.venue_id,
      documentId: document.id,
      type: "inventory.document.ready_for_review",
      title: `Акт № ${document.document_number} готов к проверке`,
      body: syncResult.resultsFound
        ? "Исполнитель завершил акт. Проверьте итоги и при необходимости верните на пересчёт."
        : "Исполнитель завершил акт, но Quick Resto не вернул построчные итоги — нужна проверка.",
    });

    revalidatePath("/documents/inventory");
    revalidatePath(`/documents/inventory/${document.id}`);
    revalidatePath(`/documents/inventory/${document.id}/results`);
    return { resultsHasLineAmounts: syncResult.resultsFound, error: null };
  } catch (error) {
    return {
      resultsHasLineAmounts: false,
      error: actionErrorMessage(error, "Не удалось отправить акт в Quick Resto"),
    };
  }
}

// ============================================================
// Детальная страница ингредиента (Этап 1 «Номенклатура»/«Документы»):
// локальное описание, связка с поставщиками, журнал событий.
// ============================================================
