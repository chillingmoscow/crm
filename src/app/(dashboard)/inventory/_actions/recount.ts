"use server";

// Пересчёт: флаги строк, возврат акта и вынос позиций в отдельный акт.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  createInventoryDocumentBackOffice,
  createInventoryItemBackOffice,
  removeInventoryDocumentBackOffice,
  removeInventoryItemBackOffice,
  readInventoryDocument,
  type QuickRestoInventoryItem2
} from "@/lib/integrations/quickresto/client";
import {
  actionErrorMessage,
  assertDocumentVisible,
  connectionPassword,
  dateText,
  externalProductId,
  getActiveContext,
  getActiveResortItemIds,
  getConnection,
  getResultDocumentForAction,
  inventoryDocumentNumber,
  listBackOfficeInventoryItemsWithSession,
  notifyInventoryDocumentEvent,
  refreshLocalInventoryDocumentFromPayload,
  revalidateInventoryResultPages,
  withBackOfficeSession,
  writeInventoryResultEvent,
  writeInventoryResultEvents
} from "../actions-shared";

/**
 * Менеджер помечает (или снимает пометку) на строке акта как «требует
 * пересчёта». Ручной toggle; recount_marked_by фиксирует «человек тронул»,
 * чтобы триггер `inventory_apply_recount_threshold` (миграция 209) не
 * перезатёр ручное решение авто-логикой.
 *
 * Permission: `inventory.recount_documents`.
 */
export async function setRecountFlag(input: {
  documentId: string;
  itemId: string;
  needsRecount: boolean;
  note?: string | null;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.recount_documents"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    // requireOpen: финализированные итоги нельзя менять (Codex P2 #399 —
    // server-side инвариант должен совпадать с UI, иначе обход через
    // прямой вызов server action).
    const document = await getResultDocumentForAction({
      admin,
      supabase: ctx.supabase,
      accountId: ctx.accountId,
      documentId: input.documentId,
      requireOpen: true,
    });

    const { error } = await admin
      .from("document_items")
      .update({
        needs_recount: input.needsRecount,
        recount_auto_flagged: false, // переход в ручной режим
        recount_marked_by: ctx.user.id,
        recount_marked_at: new Date().toISOString(),
        recount_note: input.note?.trim() || null,
      })
      .eq("id", input.itemId)
      .eq("document_id", document.id)
      .eq("account_id", ctx.accountId);
    if (error) throw new Error(error.message);

    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: document.id,
      documentItemId: input.itemId,
      eventType: input.needsRecount ? "recount_marked" : "recount_unmarked",
      message: input.needsRecount ? "Отметил строку на пересчёт" : "Снял пометку пересчёта",
      payload: { itemId: input.itemId, note: input.note?.trim() || null },
    });

    revalidateInventoryResultPages(document.id);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось изменить пометку пересчёта") };
  }
}

/**
 * Массовая отметка/снятие пометки пересчёта (bulk-бар). Право
 * inventory.recount_documents. Bulk-UPDATE (атомарно) + событие на строку.
 */
export async function bulkSetRecountFlag(input: {
  documentId: string;
  itemIds: string[];
  needsRecount: boolean;
}): Promise<{ updated: number; error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.recount_documents"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { updated: 0, error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    const document = await getResultDocumentForAction({
      admin,
      supabase: ctx.supabase,
      accountId: ctx.accountId,
      documentId: input.documentId,
      requireOpen: true,
    });
    const itemIds = Array.from(new Set(input.itemIds)).filter(Boolean);
    if (itemIds.length === 0) return { updated: 0, error: "Не выбрано ни одной строки" };

    const { data: itemsRaw } = await admin
      .from<Array<{ id: string; product_name: string }>>("document_items")
      .select("id, product_name")
      .eq("account_id", ctx.accountId)
      .eq("document_id", document.id)
      .in("id", itemIds);
    const items = itemsRaw ?? [];
    if (items.length === 0) return { updated: 0, error: null };

    const { error } = await admin
      .from("document_items")
      .update({
        needs_recount: input.needsRecount,
        recount_auto_flagged: false, // переход в ручной режим
        recount_marked_by: ctx.user.id,
        recount_marked_at: new Date().toISOString(),
        recount_note: null,
      })
      .eq("account_id", ctx.accountId)
      .eq("document_id", document.id)
      .in("id", items.map((item) => item.id));
    if (error) throw new Error(error.message);

    await writeInventoryResultEvents({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: document.id,
      eventType: input.needsRecount ? "recount_marked" : "recount_unmarked",
      events: items.map((item) => ({
        documentItemId: item.id,
        message: input.needsRecount ? "Отметил строку на пересчёт" : "Снял пометку пересчёта",
        payload: { itemId: item.id, bulk: true },
      })),
      auditPayload: { bulk: true, count: items.length, needsRecount: input.needsRecount },
    });

    revalidateInventoryResultPages(document.id);
    return { updated: items.length, error: null };
  } catch (error) {
    return { updated: 0, error: actionErrorMessage(error, "Не удалось изменить пометки пересчёта") };
  }
}

/**
 * Менеджер возвращает акт исполнителю на пересчёт. Меняет статус акта на
 * `recount_pending`, увеличивает `recount_count`, ставит `last_returned_at`
 * (используется в editor-hydration для invalidation IndexedDB-черновика).
 *
 * Преконды:
 *  - У акта есть ≥1 позиция с `needs_recount = true`.
 *  - Статус акта — `ready_for_review` или `results_blocked`. После
 *    `processed` возврат бессмысленен (QR-side уже закрыт).
 *  - permission `inventory.recount_documents`.
 */
export async function returnDocumentForRecount(input: {
  documentId: string;
  note?: string | null;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.recount_documents"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    await assertDocumentVisible({ supabase: ctx.supabase, documentId: input.documentId });
    const { data: document } = await admin
      .from<{
        id: string;
        status: string;
        recount_count: number | null;
        results_finalized_at: string | null;
        assigned_to: string | null;
        reviewer_id: string | null;
        document_number: string;
        venue_id: string | null;
      }>("documents")
      .select(
        "id, status, recount_count, results_finalized_at, assigned_to, reviewer_id, document_number, venue_id",
      )
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!document?.id) return { error: "Акт не найден" };
    if (document.results_finalized_at) {
      return { error: "Итоги уже финализированы. Сначала переоткройте их." };
    }
    if (document.status !== "ready_for_review" && document.status !== "results_blocked") {
      return {
        error:
          "Вернуть на пересчёт можно только акт со статусом «Готов к проверке» или «Итоги требуют проверки».",
      };
    }

    const { data: flaggedItems } = await admin
      .from<Array<{ id: string; actual_amount: number | null }>>("document_items")
      .select("id, actual_amount")
      .eq("document_id", document.id)
      .eq("account_id", ctx.accountId)
      .eq("needs_recount", true);
    const flaggedIds = (flaggedItems ?? []).map((row) => row.id);
    if (flaggedIds.length === 0) {
      return { error: "Отметьте хотя бы одну строку на пересчёт перед отправкой." };
    }

    // Снимок «было»: фиксируем текущий факт каждой отмеченной строки в
    // recount_previous_amount, чтобы после пересчёта сравнить с новым значением
    // и видеть в Итогах, какие строки уходили на пересчёт. Не очищается при
    // повторном проведении (см. миграцию 218); на повторных кругах
    // перезаписываем значением перед текущим кругом.
    for (const item of flaggedItems ?? []) {
      await admin
        .from("document_items")
        .update({ recount_previous_amount: item.actual_amount })
        .eq("id", item.id)
        .eq("account_id", ctx.accountId);
    }

    const { error: updateError } = await admin
      .from("documents")
      .update({
        status: "recount_pending",
        recount_count: (document.recount_count ?? 0) + 1,
        last_returned_at: new Date().toISOString(),
        // Авто-фоллбэк: вернувший на пересчёт становится проверяющим, если
        // поле пусто (детерминирует адресата будущих уведомлений «готов
        // к проверке»).
        ...(document.reviewer_id ? {} : { reviewer_id: ctx.user.id }),
      })
      .eq("id", document.id)
      .eq("account_id", ctx.accountId);
    if (updateError) throw new Error(updateError.message);

    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: document.id,
      eventType: "returned_for_recount",
      message: "Отправил акт на пересчёт",
      payload: {
        flaggedItemIds: flaggedIds,
        recountCount: (document.recount_count ?? 0) + 1,
        note: input.note?.trim() || null,
      },
    });

    // Уведомляем исполнителя: акт вернулся к нему на пересчёт.
    await notifyInventoryDocumentEvent({
      admin,
      recipientId: document.assigned_to,
      actorId: ctx.user.id,
      venueId: document.venue_id,
      documentId: document.id,
      type: "inventory.document.returned_for_recount",
      title: `Акт № ${document.document_number} вернули на пересчёт`,
      body: `Перепроверьте отмеченные позиции (${flaggedIds.length}) и завершите пересчёт.`,
    });

    revalidateInventoryResultPages(document.id);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось отправить акт на пересчёт") };
  }
}

/**
 * Вынести отмеченные позиции в отдельный акт пересчёта с датой пересчёта.
 *
 * Зачем: расчётный остаток в Quick Resto привязан к дате акта. Позиция, которую
 * пересчитывают через день-два, в исходном акте сравнивалась бы с остатком на
 * его дату — и всё движение между датами (поставка, продажи) попадало бы в
 * разницу. В отдельном акте с датой пересчёта базу считает сам QR.
 *
 * Как это ложится на Quick Resto API (проверено на проде 2026-08-26):
 *  - акт создаётся ПУСТЫМ (`document.v2/create`), позиции добавляются по одной
 *    (`items/create`);
 *  - вынесенные строки из исходного акта именно УДАЛЯЮТСЯ
 *    (`items/remove`) — в акте не остаётся фиктивного «сошлось»;
 *  - операция идемпотентна: если акт пересчёта на эту дату уже создан
 *    (предыдущая попытка упала на середине), мы продолжаем наполнять его.
 *    Если упали до первой перенесённой позиции — созданный акт удаляется
 *    (`document.v2/remove`), чтобы не плодить пустышки.
 */
export async function splitDocumentForRecount(input: {
  documentId: string;
  /** Дата пересчёта, YYYY-MM-DD. */
  recountDate: string;
  note?: string | null;
}): Promise<{ error: string | null; recountDocumentId?: string }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.recount_documents"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  // Любой отказ логируем: сообщение уходит пользователю тостом, но в прод-логах
  // без этого не остаётся ничего — по акту СВ343 причину пришлось искать по БД.
  const fail = (error: string) => {
    console.warn("[splitDocumentForRecount] отказ", { documentId: input.documentId, error });
    return { error };
  };
  try {
    await assertDocumentVisible({ supabase: ctx.supabase, documentId: input.documentId });
    const { data: document } = await admin
      .from<{
        id: string;
        status: string;
        results_finalized_at: string | null;
        assigned_to: string | null;
        reviewer_id: string | null;
        document_number: string;
        venue_id: string | null;
        store_id: string | null;
        external_store_id: string | null;
        external_id: string | null;
        archived_at: string | null;
        processed: boolean;
      }>("documents")
      .select(
        "id, status, results_finalized_at, assigned_to, reviewer_id, document_number, venue_id, store_id, external_store_id, external_id, archived_at, processed",
      )
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (!document?.id) return fail("Акт не найден");
    if (document.archived_at) return fail("Акт удалён в Quick Resto.");
    if (document.processed || document.results_finalized_at) {
      return fail("Акт уже проведён. Вынести позиции можно только до проведения.");
    }
    if (document.status !== "ready_for_review" && document.status !== "results_blocked") {
      return fail(
        "Вынести позиции можно только у акта со статусом «Готов к проверке» или «Итоги требуют проверки».",
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.recountDate)) {
      return fail("Некорректная дата пересчёта.");
    }
    const externalStoreId = Number(document.external_store_id);
    if (!Number.isFinite(externalStoreId)) {
      return fail("У акта не определён склад Quick Resto.");
    }
    const documentExternalId = Number(document.external_id);
    if (!Number.isFinite(documentExternalId)) {
      return fail("У акта некорректный ID Quick Resto.");
    }

    const { data: flaggedItems } = await admin
      .from<
        Array<{
          id: string;
          external_item_id: string;
          product_name: string;
          ingredient_id: string | null;
          calculated_amount: number | null;
          raw_payload: QuickRestoInventoryItem2 | null;
        }>
      >("document_items")
      .select("id, external_item_id, product_name, ingredient_id, calculated_amount, raw_payload")
      .eq("document_id", document.id)
      .eq("account_id", ctx.accountId)
      .eq("needs_recount", true);
    const flagged = flaggedItems ?? [];
    if (flagged.length === 0) return fail("Отметьте хотя бы одну строку на пересчёт.");
    const withoutPayload = flagged.filter((item) => !item.raw_payload?.product);
    if (withoutPayload.length > 0) {
      return fail(
        `По ${withoutPayload.length} строкам нет данных Quick Resto — обновите итоги и повторите.`,
      );
    }

    // Строку, сведённую в активный пересорт, выносить нельзя: она удаляется из
    // акта, а вместе с ней каскадом уходит половина пересорта. Тот же гард, что
    // на исключении строки из итогов.
    const activeResortItemIds = await getActiveResortItemIds({
      admin,
      accountId: ctx.accountId,
      documentId: document.id,
      itemIds: flagged.map((item) => item.id),
    });
    if (activeResortItemIds.size > 0) {
      const names = flagged
        .filter((item) => activeResortItemIds.has(item.id))
        .map((item) => item.product_name)
        .slice(0, 3)
        .join(", ");
      return fail(`Позиции в активном пересорте выносить нельзя — сначала отмените пересорт (${names}).`);
    }

    const connection = await getConnection(ctx.accountId);
    if (!connection) return fail("Активное подключение Quick Resto не найдено");
    const basicAuthPassword = connectionPassword(connection);
    const qrAuth = {
      layerName: connection.login,
      baseUrl: connection.backoffice_base_url,
      basicAuthLogin: connection.login,
      basicAuthPassword,
    };

    // Идемпотентность: акт пересчёта мог быть создан предыдущей (упавшей)
    // попыткой, а удалить его в QR нельзя — поэтому продолжаем наполнять его.
    const { data: existingChildren } = await admin
      .from<Array<{ id: string; external_id: string; invoice_date: string | null }>>("documents")
      .select("id, external_id, invoice_date")
      .eq("account_id", ctx.accountId)
      .eq("recount_of_document_id", document.id)
      .eq("processed", false);
    const existingChild = (existingChildren ?? []).find(
      (row) => (row.invoice_date ?? "").slice(0, 10) === input.recountDate,
    );

    let recountExternalId = existingChild ? Number(existingChild.external_id) : null;
    let recountLocalId = existingChild?.id ?? null;

    if (!recountExternalId || !Number.isFinite(recountExternalId)) {
      // 09:00 UTC — безопасная точка внутри суток: QR трактует дату в таймзоне
      // заведения, и полночь могла бы «съехать» на предыдущий день.
      const invoiceDate = Date.parse(`${input.recountDate}T09:00:00.000Z`);
      const createdDoc = await withBackOfficeSession({
        connection,
        admin,
        run: (cookieHeader) =>
          createInventoryDocumentBackOffice({
            ...qrAuth,
            cookieHeader,
            storeId: externalStoreId,
            invoiceDate,
            comment: `Пересчёт по акту ${document.document_number}`,
          }),
      });
      if (typeof createdDoc?.id !== "number") {
        return fail("Quick Resto не создал акт пересчёта. Попробуйте ещё раз.");
      }
      recountExternalId = createdDoc.id;

      const { data: localChild, error: childError } = await admin
        .from<{ id: string }>("documents")
        .upsert(
          {
            account_id: ctx.accountId,
            external_id: String(createdDoc.id),
            document_kind: "inventory",
            document_number: inventoryDocumentNumber(createdDoc),
            invoice_date: dateText(createdDoc.invoiceDate) ?? `${input.recountDate}T09:00:00.000Z`,
            store_id: document.store_id,
            external_store_id: document.external_store_id,
            status: document.assigned_to ? "assigned" : "synced",
            processed: false,
            results_has_line_amounts: false,
            comment: `Пересчёт по акту ${document.document_number}`,
            qr_payload: createdDoc,
            synced_at: new Date().toISOString(),
            recount_of_document_id: document.id,
            assigned_to: document.assigned_to,
            reviewer_id: document.reviewer_id ?? ctx.user.id,
          },
          { onConflict: "account_id,external_id" },
        )
        .select("id")
        .single();
      if (childError || !localChild?.id) {
        return {
          error: `Акт пересчёта создан в Quick Resto (id ${createdDoc.id}), но не сохранён локально: ${childError?.message ?? "неизвестная ошибка"}`,
        };
      }
      recountLocalId = localChild.id;
    }

    const targetExternalId = recountExternalId as number;
    const targetLocalId = recountLocalId as string;

    // Возобновление после частичного сбоя: строки, которые уже переехали,
    // трогать нельзя — в дочернем акте они создались бы повторно, а удалять их
    // из исходного уже нечего. Источник истины о переносе — inventory_recount_moves.
    const { data: doneMoves } = await admin
      .from<Array<{ external_item_id: string }>>("inventory_recount_moves")
      .select("external_item_id")
      .eq("account_id", ctx.accountId)
      .eq("document_id", document.id)
      .eq("recount_document_id", targetLocalId);
    const alreadyMoved = new Set((doneMoves ?? []).map((row) => row.external_item_id));
    const pending = flagged.filter((item) => !alreadyMoved.has(item.external_item_id));
    if (pending.length === 0) {
      return fail("Эти позиции уже вынесены в акт пересчёта — обновите страницу.");
    }

    // Снимок обоих актов в Quick Resto ДО переноса. Нужен для повторного
    // запуска после обрыва: след переноса (inventory_recount_moves) пишется
    // только когда позиция уже уехала, поэтому окно «создали в дочернем, но не
    // успели записать след» ничем не покрыто. Без этих двух множеств повтор
    // создавал ВТОРУЮ такую же строку в акте пересчёта, а следом падал на
    // удалении уже удалённой — и так на каждом повторе.
    const productKey = (item: QuickRestoInventoryItem2) => externalProductId(item) ?? null;
    const readProductKeys = async (documentId: number) => {
      try {
        const items = await listBackOfficeInventoryItemsWithSession({
          connection,
          admin,
          documentExternalId: documentId,
        });
        return new Set(items.map(productKey).filter((key): key is string => Boolean(key)));
      } catch {
        // Состояние акта неизвестно — работаем как раньше: делаем оба шага и
        // полагаемся на ошибку Quick Resto. Пропускать шаг «на всякий случай»
        // здесь нельзя: это молча оставило бы позицию в исходном акте.
        return null;
      }
    };
    const [alreadyInChild, stillInSource] = await Promise.all([
      readProductKeys(targetExternalId),
      readProductKeys(documentExternalId),
    ]);

    const moved: string[] = [];
    try {
      for (const item of pending) {
        const sample = item.raw_payload as QuickRestoInventoryItem2;
        const key = productKey(sample);
        // Сначала кладём позицию в акт пересчёта, потом убираем из исходного:
        // при сбое между шагами позиция максимум задвоится, а не пропадёт.
        // Оба шага пропускаем, если Quick Resto уже в нужном состоянии, —
        // так повтор после обрыва доводит перенос до конца, а не плодит дубли.
        if (!key || !alreadyInChild || !alreadyInChild.has(key)) {
          await withBackOfficeSession({
            connection,
            admin,
            run: (cookieHeader) =>
              createInventoryItemBackOffice({
                ...qrAuth,
                cookieHeader,
                documentId: targetExternalId,
                sample,
                actualAmount: 0,
              }),
          });
          if (key) alreadyInChild?.add(key);
        }

        if (!key || !stillInSource || stillInSource.has(key)) {
          await withBackOfficeSession({
            connection,
            admin,
            run: (cookieHeader) =>
              removeInventoryItemBackOffice({
                ...qrAuth,
                cookieHeader,
                documentId: documentExternalId,
                item: sample,
              }),
          });
          if (key) stillInSource?.delete(key);
        }

        // След переноса — раньше его ошибка проглатывалась, и позиция,
        // фактически уехавшая, оставалась «неперенесённой» для повтора.
        const { error: moveError } = await admin.from("inventory_recount_moves").insert({
          account_id: ctx.accountId,
          document_id: document.id,
          recount_document_id: targetLocalId,
          external_item_id: item.external_item_id,
          product_name: item.product_name,
          ingredient_id: item.ingredient_id,
          moved_by: ctx.user.id,
        });
        if (moveError) throw new Error(`не удалось записать перенос позиции: ${moveError.message}`);

        // Строки в Quick Resto больше нет — убираем её и локально, сразу после
        // успешного переноса. Полагаться на последующий импорт нельзя: если
        // вынесли ВСЕ позиции, backoffice вернёт пустой список, а защита от
        // пустого ответа (syncDocumentItems) намеренно сохранит локальные
        // строки — исходный акт продолжил бы показывать уехавшие позиции.
        await admin
          .from("document_items")
          .delete()
          .eq("id", item.id)
          .eq("account_id", ctx.accountId);
        moved.push(item.id);
      }
    } catch (moveError) {
      const message = moveError instanceof Error ? moveError.message : "Quick Resto не ответил";
      if (moved.length === 0 && !existingChild) {
        // Ничего перенести не успели — убираем за собой пустой акт.
        try {
          const createdQrDoc = await readInventoryDocument({
            layerName: connection.login,
            login: connection.login,
            password: basicAuthPassword,
            objectId: targetExternalId,
          });
          await withBackOfficeSession({
            connection,
            admin,
            run: (cookieHeader) =>
              removeInventoryDocumentBackOffice({ ...qrAuth, cookieHeader, document: createdQrDoc }),
          });
          await admin
            .from("documents")
            .delete()
            .eq("id", targetLocalId)
            .eq("account_id", ctx.accountId);
        } catch (rollbackError) {
          console.error("[splitDocumentForRecount] откат пустого акта не удался", rollbackError);
        }
        return { error: `Не удалось перенести позиции: ${message}` };
      }
      return {
        error:
          `Перенесено позиций: ${moved.length} из ${pending.length}, дальше Quick Resto ответил ошибкой: ${message}. ` +
          "Повторите операцию — оставшиеся позиции уйдут в тот же акт пересчёта.",
      };
    }

    // Отметки пересчёта отдельно не снимаем: перенесённые строки удалены
    // из акта целиком (см. цикл выше), снимать флаг уже не с чего.

    // Перечитываем оба акта — состояние после правок берём у источника правды.
    for (const target of [
      { localId: document.id, externalId: documentExternalId },
      { localId: targetLocalId, externalId: targetExternalId },
    ]) {
      try {
        const qrDoc = await readInventoryDocument({
          layerName: connection.login,
          login: connection.login,
          password: basicAuthPassword,
          objectId: target.externalId,
        });
        const boItems = await listBackOfficeInventoryItemsWithSession({
          connection,
          admin,
          documentExternalId: target.externalId,
        });
        await refreshLocalInventoryDocumentFromPayload({
          admin,
          accountId: ctx.accountId,
          documentId: target.localId,
          document: { ...qrDoc, effectedItems: boItems },
        });
      } catch (refreshError) {
        console.error("[splitDocumentForRecount] перечитать акт не удалось", {
          documentId: target.localId,
          error: refreshError,
        });
      }
    }

    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: document.id,
      eventType: "recount_split",
      message: `Вынес позиции на пересчёт (${moved.length}) в отдельный акт на ${input.recountDate}`,
      payload: {
        recountDocumentId: targetLocalId,
        recountExternalId: targetExternalId,
        recountDate: input.recountDate,
        itemCount: moved.length,
        // Названия кладём в payload: строки уже удалены из акта, и по id их
        // потом не восстановить — журнал остался бы без имён позиций.
        productNames: pending
          .filter((item) => moved.includes(item.id))
          .map((item) => item.product_name),
        note: input.note ?? null,
      },
    });
    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: targetLocalId,
      eventType: "recount_split",
      message: `Акт пересчёта по акту № ${document.document_number}`,
      payload: {
        parentDocumentId: document.id,
        itemCount: moved.length,
        productNames: pending
          .filter((item) => moved.includes(item.id))
          .map((item) => item.product_name),
      },
    });

    if (document.assigned_to) {
      await notifyInventoryDocumentEvent({
        admin,
        recipientId: document.assigned_to,
        actorId: ctx.user.id,
        venueId: document.venue_id,
        documentId: targetLocalId,
        type: "inventory.document.assigned",
        title: "Назначен акт пересчёта",
        body: `Позиции из акта № ${document.document_number} нужно пересчитать в новом акте на ${input.recountDate}.`,
      });
    }

    revalidatePath("/documents/inventory");
    revalidateInventoryResultPages(document.id);
    revalidateInventoryResultPages(targetLocalId);
    return { error: null, recountDocumentId: targetLocalId };
  } catch (error) {
    console.error("[splitDocumentForRecount] исключение", {
      documentId: input.documentId,
      error,
    });
    return { error: actionErrorMessage(error, "Не удалось вынести позиции в акт пересчёта") };
  }
}
