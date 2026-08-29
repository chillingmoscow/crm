"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import {
  calculateResortAllocation,
  type InventoryResortAllocationItem,
} from "@/lib/inventory/results";
import {
  getAssigneeLockReason,
  getInventoryResultRefreshLockReason,
  getReviewerLockReason,
  hasCountedResults,
  isInventoryFormLocked,
  nextStatusAfterAssign,
  resolveQrUnprocessedAt,
  resolveStatusAfterSync,
} from "@/lib/inventory/act-status";
import {
  compareResultLines,
  describeResultDrift,
  hasResultDrift,
  type InventoryRecheckLine,
} from "@/lib/inventory/results-recheck";
import { getIngredientDetail, type IngredientDetail } from "@/lib/inventory/ingredients";
import { resolveManualExclusionState } from "@/lib/inventory/exclusions";
import { pluralRu } from "@/lib/format/plural";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import {
  createInventoryDocumentBackOffice,
  createInventoryItemBackOffice,
  removeInventoryDocumentBackOffice,
  removeInventoryItemBackOffice,
  listDishes,
  listIngredientTreeItems,
  listInventoryDocuments,
  listSemiProducts,
  listStores,
  readInventoryDocument,
  updateInventoryItemBackOffice,
  type QuickRestoInventoryDocument2,
  type QuickRestoInventoryItem2,
  type QuickRestoSingleCategory,
  type QuickRestoSingleProduct,
} from "@/lib/integrations/quickresto/client";
import {
  actionErrorMessage,
  amountsEqual,
  buildStoragePath,
  connectionPassword,
  dateText,
  externalItemId,
  extractLineResult,
  getActiveContext,
  getActiveResortItemIds,
  getConnection,
  getResultDocumentForAction,
  groupName,
  inventoryDocumentItems,
  inventoryDocumentNumber,
  isDeletedQuickRestoRow,
  isQuickRestoClass,
  isRecentOpenInventoryDocument,
  assertDocumentVisible,
  externalProductId,
  filterVisibleDocumentIds,
  listBackOfficeInventoryItemsWithSession,
  loadActiveExclusionRuleMatcher,
  loadResultItemsForAdjustment,
  normalizeReason,
  num,
  quickRestoDocumentSums,
  RESORT_STATUS,
  priceNum,
  processBackOfficeInventoryDocumentWithSession,
  productName,
  quickRestoParentExternalId,
  readActualAmountsByExternalItemId,
  refreshLocalInventoryDocumentFromPayload,
  resolveDefaultVenueId,
  resolveResultItemGroup,
  resultItemMeasureKey,
  revalidateInventoryResultPages,
  sameDate,
  saveSnapshot,
  storeTitle,
  syncDocumentItems,
  text,
  upsertExternalLink,
  withBackOfficeSession,
  writeInventoryResultEvent,
  type InventoryExclusionRuleLookup,
  type InventoryProductLookup,
  type InventoryResultItemRow,
  type InventoryStoreLookup,
  type InventorySyncSummary,
} from "./actions-shared";
import { buildAiSuggestions, type AiSuggestionSourceItem } from "@/lib/inventory/resort-ai-suggestions";
import type { ResortSuggestion } from "@/lib/inventory/resort-suggestions";


/**
 * Сколько построчных запросов к backoffice Quick Resto держим одновременно.
 * Последовательный цикл упирался в latency (акт на 300 позиций — минуты),
 * Promise.all по всему акту завалил бы и QR, и пул соединений. Держим
 * умеренно: каждый воркер при протухшем cookie может пойти за новым.
 */
const QR_ITEM_CONCURRENCY = 5;

export async function syncQuickRestoInventory(input?: {
  scope?: "documents" | "full";
}): Promise<{
  summary: InventorySyncSummary | null;
  error: string | null;
}> {
  const ctx = await getActiveContext("inventory.sync_quickresto");
  if (ctx.error || !ctx.user || !ctx.accountId) return { summary: null, error: ctx.error };

  const connection = await getConnection(ctx.accountId);
  if (!connection) return { summary: null, error: "Активное подключение Quick Resto не найдено" };

  try {
  const admin = asLooseDb(createAdminClient());
  const password = connectionPassword(connection);
  const auth = { layerName: connection.login, login: connection.login, password };
  const syncedAt = new Date().toISOString();
  const scope = input?.scope ?? "full";
  const summary: InventorySyncSummary = {
    groups: 0,
    products: 0,
    stores: 0,
    documents: 0,
    items: 0,
    resultsBlocked: 0,
    failedDocuments: 0,
  };

  const groupByExternalId = new Map<string, string>();
  const productByExternalId = new Map<string, InventoryProductLookup>();
  const storeByExternalId = new Map<string, string>();
  let documentList: QuickRestoInventoryDocument2[] = [];

  if (scope === "full") {
    const defaultVenueId = await resolveDefaultVenueId({
      admin,
      accountId: ctx.accountId,
      activeVenueId: ctx.venueId,
    });

    const [storeItemsRaw, stores, loadedDocuments] = await Promise.all([
      listIngredientTreeItems(auth),
      listStores(auth),
      listInventoryDocuments(auth),
    ]);
    documentList = loadedDocuments;
    const storeItems = storeItemsRaw as Array<QuickRestoSingleCategory | QuickRestoSingleProduct>;
    const groups = storeItems.filter((item): item is QuickRestoSingleCategory =>
      isQuickRestoClass(item, "SingleCategory")
    );
    const products = storeItems.filter((item): item is QuickRestoSingleProduct =>
      isQuickRestoClass(item, "SingleProduct")
    );

    const productExternalIds = products
      .map((product) => (typeof product.id === "number" ? String(product.id) : null))
      .filter((id): id is string => Boolean(id));
    // Reconciliation полностью обеспечивают upsert (по onConflict) +
    // soft-archive пропавших ингредиентов ниже. Прежний pre-delete блок
    // удалён: он перекрёстно путал таблицы/списки id (ingredients ↔
    // ingredient_groups) и hard-удалял ингредиенты вопреки soft-archive
    // политике.

    for (const group of groups) {
      if (typeof group.id !== "number") continue;
      const parentExternalId = quickRestoParentExternalId(group);

      const { data, error } = await admin
        .from<{ id: string }>("ingredient_groups")
        .upsert(
          {
            account_id: ctx.accountId,
            external_id: String(group.id),
            name: groupName(group),
            item_title: text(group.itemTitle),
            parent_group_id: null,
            parent_external_id: parentExternalId,
            raw_payload: group,
            synced_at: syncedAt,
          },
          { onConflict: "account_id,external_id" }
        )
        .select("id")
        .single();
      if (error || !data?.id) throw new Error(error?.message ?? `Не удалось сохранить группу ${group.id}`);

      groupByExternalId.set(String(group.id), data.id);
      summary.groups += 1;
      await upsertExternalLink({
        admin,
        accountId: ctx.accountId,
        entityType: "ingredient_group",
        externalId: String(group.id),
        localTable: "ingredient_groups",
        localId: data.id,
      });
      await saveSnapshot({ admin, accountId: ctx.accountId, entityType: "ingredient_group", externalId: String(group.id), payload: group });
    }

    for (const group of groups) {
      const localId = groupByExternalId.get(String(group.id));
      const parentExternalId = quickRestoParentExternalId(group);
      const parentId = parentExternalId ? groupByExternalId.get(parentExternalId) : null;
      if (localId) {
        await admin
          .from("ingredient_groups")
          .update({ parent_group_id: parentId ?? null })
          .eq("id", localId);
      }
    }

    for (const product of products) {
      if (typeof product.id !== "number") continue;
      const parentExternalId = quickRestoParentExternalId(product);
      const groupId = parentExternalId ? groupByExternalId.get(parentExternalId) ?? null : null;

      const { data, error } = await admin
        .from<InventoryProductLookup>("ingredients")
        .upsert(
          {
            account_id: ctx.accountId,
            external_id: String(product.id),
            kind: "ingredient",
            external_version: typeof product.version === "number" ? product.version : null,
            name: productName(product, `Ингредиент #${product.id}`),
            item_title: text(product.itemTitle),
            article: text(product.article),
            barcode: text(product.barCode),
            measure_unit_id: typeof product.measureUnit?.id === "number" ? product.measureUnit.id : null,
            measure_unit_name: text(product.measureUnit?.name),
            measure_unit_full_name: text(product.measureUnit?.fullName),
            measure_unit_code: text(product.measureUnit?.code),
            ratio: num(product.ratio),
            group_id: groupId,
            parent_external_id: parentExternalId,
            tags: Array.isArray(product.storeItemTags) ? product.storeItemTags : [],
            current_prime_cost: num(product.currentPrimeCost),
            store_quantity_kg: num(product.storeQuantityKg),
            stock_limit: num(product.limit),
            raw_payload: product,
            synced_at: syncedAt,
          },
          { onConflict: "account_id,external_id" }
        )
        .select("id, external_id, article, barcode")
        .single();
      if (error || !data?.id) throw new Error(error?.message ?? `Не удалось сохранить ингредиент ${product.id}`);

      productByExternalId.set(String(product.id), data);
      summary.products += 1;
      await upsertExternalLink({
        admin,
        accountId: ctx.accountId,
        entityType: "ingredient",
        externalId: String(product.id),
        localTable: "ingredients",
        localId: data.id,
      });
      await saveSnapshot({ admin, accountId: ctx.accountId, entityType: "ingredient", externalId: String(product.id), payload: product });
    }

    // Soft-archive ингредиентов, пропавших из QuickResto. Не удаляем:
    // сохраняем историю в актах, локальные поля, поставщиков, журнал.
    // Вернувшиеся в выгрузку — разархивируем.
    {
      const incoming = new Set(productExternalIds);
      const { data: localProducts } = await admin
        .from<Array<{ id: string; external_id: string; archived_at: string | null }>>(
          "ingredients",
        )
        .select("id, external_id, archived_at")
        .eq("account_id", ctx.accountId)
        // Архивируем только ингредиенты: этот sync-путь владеет
        // kind='ingredient'. Иначе позиции других типов (dish/product/
        // semi_finished) ошибочно архивировались бы при синке ингредиентов.
        .eq("kind", "ingredient");
      const toArchive = (localProducts ?? [])
        .filter((p) => p.external_id && !incoming.has(p.external_id) && !p.archived_at)
        .map((p) => p.id);
      const toUnarchive = (localProducts ?? [])
        .filter((p) => p.external_id && incoming.has(p.external_id) && p.archived_at)
        .map((p) => p.id);
      if (toArchive.length > 0) {
        await admin
          .from("ingredients")
          .update({ archived_at: syncedAt })
          .in("id", toArchive);
      }
      if (toUnarchive.length > 0) {
        await admin
          .from("ingredients")
          .update({ archived_at: null })
          .in("id", toUnarchive);
      }
    }

    for (const store of stores) {
      if (typeof store.id !== "number") continue;
      const { data: existingStore } = await admin
        .from<{ id: string; local_venue_id: string | null }>("stores")
        .select("id, local_venue_id")
        .eq("account_id", ctx.accountId)
        .eq("external_id", String(store.id))
        .maybeSingle();
      const { data, error } = await admin
        .from<{ id: string }>("stores")
        .upsert(
          {
            account_id: ctx.accountId,
            external_id: String(store.id),
            title: storeTitle(store),
            store_code: text(store.storeCode),
            description: text(store.description),
            local_venue_id: existingStore?.local_venue_id ?? defaultVenueId,
            raw_payload: store,
            synced_at: syncedAt,
          },
          { onConflict: "account_id,external_id" }
        )
        .select("id")
        .single();
      if (error || !data?.id) throw new Error(error?.message ?? `Не удалось сохранить склад ${store.id}`);

      storeByExternalId.set(String(store.id), data.id);
      summary.stores += 1;
      await upsertExternalLink({
        admin,
        accountId: ctx.accountId,
        entityType: "store",
        externalId: String(store.id),
        localTable: "stores",
        localId: data.id,
      });
      await saveSnapshot({ admin, accountId: ctx.accountId, entityType: "store", externalId: String(store.id), payload: store });
    }
  } else {
    const [{ data: productRows }, { data: storeRows }, loadedDocuments] = await Promise.all([
      admin
        .from<InventoryProductLookup[]>("ingredients")
        .select("id, external_id, article, barcode")
        .eq("account_id", ctx.accountId),
      admin
        .from<InventoryStoreLookup[]>("stores")
        .select("id, external_id")
        .eq("account_id", ctx.accountId),
      listInventoryDocuments(auth),
    ]);

    documentList = loadedDocuments;
    for (const product of productRows ?? []) {
      if (product.external_id) productByExternalId.set(String(product.external_id), product);
    }
    for (const store of storeRows ?? []) {
      if (store.external_id) storeByExternalId.set(String(store.external_id), store.id);
    }
  }

  const documents = documentList.filter(isRecentOpenInventoryDocument);

  for (const documentListItem of documents) {
    if (typeof documentListItem.id !== "number") continue;
    // Один сбойный акт не должен ронять весь проход: до этой обёртки
    // исключение на любом акте (недоступный backoffice, битый payload,
    // конфликт записи) обрывало цикл, и все следующие акты оставались
    // необновлёнными — молча, потому что экшен возвращал общую ошибку.
    try {
      const document = await readInventoryDocument({ ...auth, objectId: documentListItem.id });
      const externalStoreId = typeof document.store?.id === "number" ? String(document.store.id) : null;
      const storeId = externalStoreId ? storeByExternalId.get(externalStoreId) ?? null : null;

      const { data: existing } = await admin
        .from<{
          id: string;
          status: string;
          results_finalized_at: string | null;
          qr_unprocessed_at: string | null;
        }>("documents")
        .select("id, status, results_finalized_at, qr_unprocessed_at")
        .eq("account_id", ctx.accountId)
        .eq("external_id", String(document.id))
        .maybeSingle();

      // Акт распровели в Quick Resto (штатная операция бухгалтера). Он снова
      // выглядит непроведённым и свежим, поэтому доходит сюда. Молча откатывать
      // его статус нельзя: у нас лежат утверждённые итоги и снимок строк.
      // Фиксируем факт распроведения полем и событием (миграция 224).
      //
      // Признак «акт проведён у нас» — именно status, а не results_finalized_at:
      // reopenInventoryResults обнуляет results_finalized_at, оставляя акт
      // проведённым. Пока признак был завязан на results_finalized_at,
      // переоткрытый акт после распроведения в QR откатывался в 'synced' — то
      // есть ровно в том сценарии, ради которого писалась защита.
      const processedLocally = existing?.status === "processed";
      const finalizedLocally = Boolean(existing?.results_finalized_at);
      const unprocessedInQr = processedLocally && !document.processed;

      const nextStatus = resolveStatusAfterSync({
        processedInQr: Boolean(document.processed),
        existingStatus: existing?.status,
      });

      // Items: для не-проведённого акта public-API (readInventoryDocument)
      // возвращает items БЕЗ расчётного остатка и разницы (calculated/
      // difference приходят NULL). QR это всё считает в backoffice и не
      // сериализует в public payload. Решение — обходной запрос через
      // backoffice-cookie sheerly-bot'а: /platform/data/warehouse.inventory.
      // items/select?ownerContextId=... возвращает items с полным набором
      // полей. Если backoffice недоступен (нет cookie / нет creds) —
      // fallback на public-payload items (хотя бы actualAmount будет).
      const { items: publicItems } = inventoryDocumentItems(document);
      let items: typeof publicItems = publicItems;
      try {
        const boItems = await listBackOfficeInventoryItemsWithSession({
          connection,
          admin,
          documentExternalId: document.id,
        });
        // Diagnostic: видно в Coolify logs какой акт сколько вернул через
        // backoffice. CB303 (qr id 9890) на проде стабильно возвращает 0
        // — нужны логи чтобы понять specific.
        console.info(
          `[syncQuickRestoInventory] doc ${document.id} (${document.documentNumber ?? "?"}): public=${publicItems.length}, backoffice=${boItems.length}`,
        );
        if (boItems.length > 0) {
          items = boItems as typeof publicItems;
          // Сохраняем backoffice-items в qr_payload для дальнейшего
          // использования (refresh-results / просмотр сырья).
          // Заменяем effectedItems (если их не было — будут теперь).
          (document as unknown as { effectedItems: typeof publicItems }).effectedItems = boItems as typeof publicItems;
        } else {
          console.warn(
            `[syncQuickRestoInventory] doc ${document.id} (${document.documentNumber ?? "?"}): backoffice returned 0 items, falling back to public items (no calculated/difference)`,
          );
        }
      } catch (e) {
        // Backoffice не сработал — best-effort, идём с public items.
        console.error(`[syncQuickRestoInventory] backoffice items fetch failed for doc ${document.id}:`, e);
      }
      const precheckHasResults = items.some((item) => extractLineResult(item).hasResult);

      const { data, error } = await admin
        .from<{ id: string }>("documents")
        .upsert(
          {
            account_id: ctx.accountId,
            external_id: String(document.id),
            document_kind: "inventory",
            document_number: inventoryDocumentNumber(document),
            invoice_date: dateText(document.invoiceDate),
            store_id: storeId,
            external_store_id: externalStoreId,
            status: nextStatus,
            processed: Boolean(document.processed),
            base_last_update_date: dateText(document.lastUpdateDate),
            last_qr_update_date: dateText(document.lastUpdateDate),
            // У распроведённого акта Quick Resto отдаёт нулевые суммы и может не
            // вернуть построчные расчёты. Зафиксированные итоги этим перетирать
            // нельзя — иначе таблица итогов просто спрячется.
            ...(finalizedLocally
              ? {}
              : {
                  ...quickRestoDocumentSums(document),
                  results_has_line_amounts: precheckHasResults,
                }),
            qr_unprocessed_at: resolveQrUnprocessedAt({
              processedInQr: Boolean(document.processed),
              processedLocally,
              existingValue: existing?.qr_unprocessed_at,
              now: syncedAt,
            }),
            comment: text(document.comment),
            qr_payload: document,
            synced_at: syncedAt,
            // Акт пришёл живым из выгрузки → снимаем системный авто-архив,
            // если он стоял (акт удаляли в QR, потом восстановили).
            archived_at: null,
            archived_reason: null,
          },
          { onConflict: "account_id,external_id" }
        )
        .select("id")
        .single();
      if (error || !data?.id) throw new Error(error?.message ?? `Не удалось сохранить акт ${document.id}`);

      if (finalizedLocally) {
        // Строки акта с зафиксированными итогами не трогаем вообще. Импорт не
        // только перезаписывает значения — он ещё и УДАЛЯЕТ строки, которых нет
        // в ответе Quick Resto, а вместе со строкой каскадом уходят её снимок
        // (finalized_*) и позиции пересортов. То есть один импорт по акту,
        // который распровели и из которого в QR убрали позицию, менял бы уже
        // утверждённый итог. Нужны свежие данные — сначала переоткрыть итоги.
        console.info(
          `[syncQuickRestoInventory] doc ${document.id} (${document.documentNumber ?? "?"}): итоги зафиксированы — строки не импортируем`,
        );
      } else if (items.length > 0) {
        // Подсчёт остатков в нашем флоу ведётся ТОЛЬКО в CRM (submitted_amount).
        // Full-sync обновляет список позиций и метаданные акта, но НЕ должен
        // перетирать уже введённые количества QR-нулями: для непроведённого акта
        // QR присылает actualAmount=0 как дефолт. submittedAmounts не передаём —
        // syncDocumentItems сам сохраняет уже введённые значения по строкам,
        // которых нет в вызове (см. resolveSubmittedAmount). Отдельная
        // предзагрузка здесь была лишним запросом на каждый акт.
        const result = await syncDocumentItems({
          admin,
          accountId: ctx.accountId,
          documentId: data.id,
          items,
          productByExternalId,
        });
        summary.items += result.count;
        if (!result.resultsFound) summary.resultsBlocked += 1;
        if (result.resultsFound !== precheckHasResults) {
          await admin
            .from("documents")
            .update({ results_has_line_amounts: result.resultsFound })
            .eq("id", data.id);
        }
      }

      // Распроведение фиксируем один раз — на переходе. Иначе каждая
      // синхронизация плодила бы одинаковые записи в журнале акта.
      if (unprocessedInQr && !existing?.qr_unprocessed_at) {
        await writeInventoryResultEvent({
          supabase: ctx.supabase,
          admin,
          accountId: ctx.accountId,
          userId: ctx.user.id,
          documentId: data.id,
          eventType: "qr_unprocessed",
          message: "Акт распровели в Quick Resto",
          payload: { externalId: String(document.id), detectedAt: syncedAt },
        });
      }

      summary.documents += 1;
      await upsertExternalLink({
        admin,
        accountId: ctx.accountId,
        entityType: "inventory_document",
        externalId: String(document.id),
        localTable: "documents",
        localId: data.id,
      });
      await saveSnapshot({ admin, accountId: ctx.accountId, entityType: "inventory_document", externalId: String(document.id), payload: document });
    } catch (documentError) {
      summary.failedDocuments += 1;
      console.error(
        `[syncQuickRestoInventory] акт ${documentListItem.id} не обработан, продолжаем проход:`,
        documentError,
      );
    }
  }

  // Авто-архив актов, удалённых в Quick Resto. Сигнал — явный deleted-флаг в
  // выгрузке списка (isDeletedQuickRestoRow). Без этого удалённый акт навсегда
  // висел «живым» локально (его отфильтровывает isRecentOpenInventoryDocument,
  // поэтому он больше не апдейтился) — и его можно было ошибочно «провести».
  // Archived прячется из списка (RPC list_inventory_documents, миграция 216) и
  // снимается автоматически в upsert выше, если акт вернулся живым.
  // Безопасно: архивируем ТОЛЬКО по явному deleted-флагу из QR, не «по
  // отсутствию» (выгрузка может быть оконной — это дало бы ложные архивы).
  const deletedExternalIds = documentList
    .filter((doc) => isDeletedQuickRestoRow(doc) && typeof doc.id === "number")
    .map((doc) => String(doc.id));
  console.info(
    `[syncQuickRestoInventory] deleted-in-QR актов в выгрузке: ${deletedExternalIds.length}`,
  );
  if (deletedExternalIds.length > 0) {
    const { data: archived } = await admin
      .from<Array<{ id: string }>>("documents")
      .update({ archived_at: syncedAt, archived_reason: "deleted_in_quickresto" })
      .eq("account_id", ctx.accountId)
      .eq("document_kind", "inventory")
      .is("archived_at", null)
      .in("external_id", deletedExternalIds)
      .select("id");
    if (archived && archived.length > 0) {
      console.info(
        `[syncQuickRestoInventory] авто-архив удалённых в QR актов: ${archived.length}`,
      );
    }
  }

  // Бэкфилл единицы измерения ингредиентов. Каталог QR (SingleProduct) отдаёт
  // measureUnit как заглушку {id, className} без `name`, поэтому
  // ingredients.measure_unit_name приходит пустым (хотя measure_unit_id есть).
  // Позиции акта несут полную единицу (id + name) — строим словарь id→name из
  // document_items и проставляем имя ингредиентам, у которых оно отсутствует.
  const { data: unitRows } = await admin
    .from<Array<{ measure_unit_id: number | null; measure_unit_name: string | null }>>("document_items")
    .select("measure_unit_id, measure_unit_name")
    .eq("account_id", ctx.accountId);
  const unitNameById = new Map<number, string>();
  for (const row of unitRows ?? []) {
    if (typeof row.measure_unit_id === "number" && row.measure_unit_name && !unitNameById.has(row.measure_unit_id)) {
      unitNameById.set(row.measure_unit_id, row.measure_unit_name);
    }
  }
  for (const [unitId, unitName] of unitNameById) {
    await admin
      .from("ingredients")
      .update({ measure_unit_name: unitName })
      .eq("account_id", ctx.accountId)
      .eq("measure_unit_id", unitId)
      .is("measure_unit_name", null);
  }

  revalidatePath("/documents/inventory");
  if (scope === "full") {
    revalidatePath("/catalog/ingredients");
    revalidatePath("/org/stores");
  }
  return { summary, error: null };
  } catch (error) {
    return {
      summary: null,
      error: actionErrorMessage(error, "Не удалось синхронизировать Quick Resto"),
    };
  }
}

/**
 * ВРЕМЕННО (диагностика #3, блюда/полуфабрикаты): проба структуры QR-номенклатуры
 * блюд и полуфабрикатов, чтобы подтвердить модули/поля перед реальным синком.
 * Ничего не сохраняет. Возвращает счётчики + первый сэмпл каждого типа + проверку,
 * лежит ли parentId сэмпла в наших ingredient_groups (общая ли дерево категорий).
 * Удаляется после того, как структура подтверждена.
 */
export async function probeQuickRestoNomenclature(): Promise<{
  error: string | null;
  result?: {
    dishCount: number;
    semiproductCount: number;
    dishError: string | null;
    semiproductError: string | null;
    sampleDish: unknown;
    sampleSemiproduct: unknown;
    dishParentId: string | null;
    semiproductParentId: string | null;
    dishParentInGroups: boolean | null;
    semiproductParentInGroups: boolean | null;
  };
}> {
  // Гейт совпадает со страницей настроек интеграций, где показана кнопка
  // (settings.manage_integrations), а не sync_quickresto — иначе роль с
  // управлением интеграциями, но без синка, видела бы кнопку и получала отказ.
  const ctx = await getActiveContext("settings.manage_integrations");
  if (ctx.error || !ctx.accountId) return { error: ctx.error ?? "Ошибка" };

  const connection = await getConnection(ctx.accountId);
  if (!connection) return { error: "Активное подключение Quick Resto не найдено" };

  try {
    const password = connectionPassword(connection);
    const auth = { layerName: connection.login, login: connection.login, password };
    const admin = asLooseDb(createAdminClient());

    let dishes: unknown[] = [];
    let semi: unknown[] = [];
    let dishError: string | null = null;
    let semiproductError: string | null = null;
    try {
      dishes = (await listDishes(auth)) as unknown[];
    } catch (e) {
      dishError = e instanceof Error ? e.message : String(e);
    }
    try {
      semi = (await listSemiProducts(auth)) as unknown[];
    } catch (e) {
      semiproductError = e instanceof Error ? e.message : String(e);
    }

    const parentIdOf = (item: unknown): string | null => {
      const obj = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const parentItem =
        obj.parentItem && typeof obj.parentItem === "object"
          ? (obj.parentItem as Record<string, unknown>).id
          : null;
      const pid = obj.parentId ?? parentItem;
      return pid != null ? String(pid) : null;
    };
    const groupExists = async (externalId: string | null): Promise<boolean | null> => {
      if (!externalId) return null;
      const { data } = await admin
        .from<{ id: string }>("ingredient_groups")
        .select("id")
        .eq("account_id", ctx.accountId)
        .eq("external_id", externalId)
        .maybeSingle();
      return Boolean(data?.id);
    };

    const dishParentId = parentIdOf(dishes[0]);
    const semiproductParentId = parentIdOf(semi[0]);

    return {
      error: null,
      result: {
        dishCount: dishes.length,
        semiproductCount: semi.length,
        dishError,
        semiproductError,
        sampleDish: dishes[0] ?? null,
        sampleSemiproduct: semi[0] ?? null,
        dishParentId,
        semiproductParentId,
        dishParentInGroups: await groupExists(dishParentId),
        semiproductParentInGroups: await groupExists(semiproductParentId),
      },
    };
  } catch (error) {
    return { error: actionErrorMessage(error, "Проба номенклатуры не удалась") };
  }
}

/** Полное имя профиля (для сообщений журнала). null если нет. */
async function loadProfileFullName(admin: LooseDb, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await admin
    .from<{ first_name: string | null; last_name: string | null }>("profiles")
    .select("first_name, last_name")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  const name = [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
  return name || null;
}

/**
 * Best-effort уведомление по событию акта инвентаризации. Зеркалит паттерн
 * assignInventoryDocument: ошибка не валит основной flow. Не шлёт самому
 * себе и при пустом получателе (например, reviewer_id ещё не задан).
 */
async function notifyInventoryDocumentEvent(input: {
  admin: LooseDb;
  recipientId: string | null;
  actorId: string | null;
  venueId: string | null;
  documentId: string;
  type: string;
  title: string;
  body: string;
}): Promise<void> {
  if (!input.recipientId) return;
  if (input.recipientId === input.actorId) return;
  try {
    const { error } = await input.admin.from("notifications").insert({
      user_id: input.recipientId,
      venue_id: input.venueId,
      type: input.type,
      category: "inventory",
      title: input.title,
      body: input.body,
      link: `/documents/inventory/${input.documentId}`,
      actor_user_id: input.actorId,
      entity_type: "inventory_document",
      entity_id: input.documentId,
    });
    if (error) console.error(`[inventory notify ${input.type}] insert error:`, error);
  } catch (e) {
    console.error(`[inventory notify ${input.type}] threw:`, e);
  }
}

/**
 * Назначить (или снять) проверяющего акт. Зеркало assignInventoryDocument:
 * право inventory.manage_documents, гард на существование акта, best-effort
 * уведомление назначенному проверяющему.
 */
/**
 * Проведённый акт удалять нельзя: вместе со строкой documents каскадом уходят
 * снимок утверждённых итогов, пересорты и журнал решений — то есть вся
 * доказательная база по уже закрытой инвентаризации. Право
 * inventory.manage_documents такого разрешения не подразумевает.
 *
 * Условие живёт в самом DELETE (см. deleteInventoryDocument), а не в
 * предварительном SELECT: отдельная проверка «сначала прочитали, потом
 * удалили» и открывала окно, в котором акт успевали провести между этими
 * двумя шагами, и падала бы открытой при ошибке чтения (data=null читалось
 * как «блокировать нечего»). Сколько строк реально удалено, DELETE сообщает
 * сам — по нему и считаем пропущенные.
 */
const DELETE_BLOCKED_MESSAGE =
  "Проведённый акт удалить нельзя — вместе с ним пропадут утверждённые итоги и журнал решений. Если акт больше не нужен, удалите его в Quick Resto: синхронизация уберёт его и здесь.";

/**
 * Назначать акт можно только сотруднику этого аккаунта.
 *
 * Без проверки любой uuid из платформы принимался как исполнитель или
 * проверяющий: человек из чужого аккаунта получал уведомление со ссылкой на
 * акт, а его имя вставало в карточку.
 */
async function assertAssignableUser(input: {
  admin: LooseDb;
  accountId: string;
  userId: string | null;
}) {
  if (!input.userId) return; // снятие назначения
  const { data: account } = await input.admin
    .from<{ owner_id: string | null }>("accounts")
    .select("owner_id")
    .eq("id", input.accountId)
    .maybeSingle();
  if (account?.owner_id === input.userId) return;

  const { data: venues } = await input.admin
    .from<Array<{ id: string }>>("venues")
    .select("id")
    .eq("account_id", input.accountId);
  const venueIds = (venues ?? []).map((venue) => venue.id);
  if (venueIds.length > 0) {
    const { data: membership } = await input.admin
      .from<Array<{ user_id: string }>>("user_venue_roles")
      .select("user_id")
      .eq("user_id", input.userId)
      .eq("status", "active")
      .in("venue_id", venueIds);
    if ((membership ?? []).length > 0) return;
  }
  throw new Error("Пользователь не найден в этом аккаунте");
}

export async function assignInventoryReviewer(input: {
  documentId: string;
  reviewerId: string | null;
}): Promise<{ error: string | null }> {
  try {
    const ctx = await getActiveContext("inventory.manage_documents");
    if (ctx.error || !ctx.accountId) return { error: ctx.error ?? "Не удалось определить контекст" };

    const admin = asLooseDb(createAdminClient());
    // Акт чужого заведения недоступен, даже если знать его uuid.
    await assertDocumentVisible({ supabase: ctx.supabase, documentId: input.documentId });
    await assertAssignableUser({ admin, accountId: ctx.accountId, userId: input.reviewerId });

    const { data: before, error: beforeError } = await admin
      .from<{
        reviewer_id: string | null;
        document_number: string;
        venue_id: string | null;
        status: string;
      }>("documents")
      .select("reviewer_id, document_number, venue_id, status")
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (beforeError) {
      console.error("[assignInventoryReviewer] before query failed:", beforeError);
      return { error: beforeError.message };
    }
    if (!before) return { error: "Акт не найден" };

    // Инвариант: проверяющего нельзя менять у проведённого / sync_error акта.
    const reviewerLock = getReviewerLockReason(before.status);
    if (reviewerLock) return { error: reviewerLock };

    const { error } = await admin
      .from("documents")
      .update({ reviewer_id: input.reviewerId })
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId);
    if (error) {
      console.error("[assignInventoryReviewer] update failed:", error);
      return { error: error.message };
    }

    const reviewerChanged = before.reviewer_id !== input.reviewerId;
    if (reviewerChanged && ctx.user) {
      const reviewerName = await loadProfileFullName(admin, input.reviewerId);
      await writeInventoryResultEvent({
        supabase: ctx.supabase,
        admin,
        accountId: ctx.accountId,
        userId: ctx.user.id,
        documentId: input.documentId,
        eventType: "reviewer_changed",
        message: input.reviewerId
          ? `Назначил проверяющего: ${reviewerName ?? "сотрудник"}`
          : "Снял проверяющего",
        payload: { reviewerId: input.reviewerId },
      });
    }

    if (input.reviewerId && reviewerChanged) {
      await notifyInventoryDocumentEvent({
        admin,
        recipientId: input.reviewerId,
        actorId: ctx.user?.id ?? null,
        venueId: before.venue_id ?? null,
        documentId: input.documentId,
        type: "inventory.document.review_assigned",
        title: `Вы назначены проверяющим по акту № ${before.document_number}`,
        body: "Когда исполнитель завершит акт, проверьте итоги и при необходимости верните на пересчёт.",
      });
    }

    revalidatePath("/documents/inventory");
    revalidatePath(`/documents/inventory/${input.documentId}`);
    return { error: null };
  } catch (e) {
    console.error("[assignInventoryReviewer] unhandled error:", e);
    return {
      error:
        e instanceof Error && e.message
          ? e.message
          : "Не удалось назначить проверяющего. Подробности в логах.",
    };
  }
}

export async function assignInventoryDocument(input: {
  documentId: string;
  assignedTo: string | null;
}): Promise<{ error: string | null }> {
  // Outer try/catch: предотвращает «An unexpected response was received
  // from the server» (Next.js error при unhandled throw в server action).
  // Любая ошибка возвращается как { error: message } для понятного toast.
  try {
    const ctx = await getActiveContext("inventory.manage_documents");
    if (ctx.error || !ctx.accountId) return { error: ctx.error ?? "Не удалось определить контекст" };

    const admin = asLooseDb(createAdminClient());
    // Акт чужого заведения недоступен, даже если знать его uuid.
    await assertDocumentVisible({ supabase: ctx.supabase, documentId: input.documentId });
    await assertAssignableUser({ admin, accountId: ctx.accountId, userId: input.assignedTo });

    // Читаем предыдущее значение assigned_to + метаданные акта.
    // Codex P1 #383: если документа нет (id не существует или принадлежит
    // другому аккаунту) — before = null. Без этого гарда:
    //  - UPDATE становится no-op (фильтры eq не совпадают), error = null.
    //  - Notification шлётся с пустым номером и dead /documents/{id} link.
    //  - Abuse-vector: spammер с manage_documents в своём аккаунте
    //    может рассылать spam любому user-id через arbitrary documentId.
    // Гард: если документа нет — return error до UPDATE и notification.
    const { data: before, error: beforeError } = await admin
      .from<{
        assigned_to: string | null;
        document_number: string;
        venue_id: string | null;
        status: string;
      }>("documents")
      .select("assigned_to, document_number, venue_id, status")
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (beforeError) {
      console.error("[assignInventoryDocument] before query failed:", beforeError);
      return { error: beforeError.message };
    }
    if (!before) return { error: "Акт не найден" };

    // Инвариант: исполнителя нельзя менять после ухода акта на проверку /
    // проведения. Передать другому — через «Отправить на пересчёт».
    const assigneeLock = getAssigneeLockReason(before.status);
    if (assigneeLock) return { error: assigneeLock };

    const { error } = await admin
      .from("documents")
      .update({
        assigned_to: input.assignedTo,
        // Сохраняем recount_pending при смене исполнителя на пересчёте, иначе
        // assigned (или synced при снятии) — см. nextStatusAfterAssign.
        status: nextStatusAfterAssign(before.status, input.assignedTo),
      })
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId);

    if (error) {
      console.error("[assignInventoryDocument] update failed:", error);
      return { error: error.message };
    }

    // Notification назначенному, best-effort (не блокируем основной flow).
    // Шлём только при реальной смене на нового assignee (не на unassign,
    // не на повторный assign того же).
    if (
      input.assignedTo
      && before.assigned_to !== input.assignedTo
    ) {
      try {
        const { error: notifError } = await admin.from("notifications").insert({
          user_id: input.assignedTo,
          venue_id: before.venue_id ?? null,
          type: "inventory.document.assigned",
          category: "inventory",
          title: `Вам назначен акт инвентаризации № ${before.document_number}`,
          body: "Откройте акт, проверьте позиции и заполните фактические остатки.",
          link: `/documents/inventory/${input.documentId}`,
          actor_user_id: ctx.user?.id ?? null,
          entity_type: "inventory_document",
          entity_id: input.documentId,
        });
        if (notifError) {
          console.error("[assignInventoryDocument] notification insert returned error:", notifError);
        }
      } catch (e) {
        // Уведомление — bonus, не critical. Не валим основной flow.
        console.error("[assignInventoryDocument] notification threw:", e);
      }
    }

    // Журнал: фиксируем смену исполнителя (назначение и снятие).
    if (before.assigned_to !== input.assignedTo && ctx.user) {
      const assigneeName = await loadProfileFullName(admin, input.assignedTo);
      await writeInventoryResultEvent({
        supabase: ctx.supabase,
        admin,
        accountId: ctx.accountId,
        userId: ctx.user.id,
        documentId: input.documentId,
        eventType: "assignee_changed",
        message: input.assignedTo
          ? `Назначил исполнителя: ${assigneeName ?? "сотрудник"}`
          : "Снял исполнителя",
        payload: { assignedTo: input.assignedTo },
      });
    }

    revalidatePath("/documents/inventory");
    revalidatePath(`/documents/inventory/${input.documentId}`);
    return { error: null };
  } catch (e) {
    // Любая необработанная ошибка → пользователь видит понятный текст
    // вместо «An unexpected response was received from the server».
    console.error("[assignInventoryDocument] unhandled error:", e);
    return {
      error:
        e instanceof Error && e.message
          ? e.message
          : "Не удалось назначить акт. Подробности в логах.",
    };
  }
}

/**
 * Массовое назначение исполнителя или проверяющего на несколько актов сразу
 * (из плавающего bulk-бара в списке). Право inventory.manage_documents.
 * Заблокированные для назначения акты (проведён / ошибка синка) пропускаются.
 * Журнал пишется по каждому акту; уведомление назначенному — одно суммарное
 * (не N штук).
 */
export async function bulkAssignInventoryDocuments(input: {
  documentIds: string[];
  role: "assignee" | "reviewer";
  userId: string | null;
}): Promise<{ updated: number; skipped: number; error: string | null }> {
  try {
    const ctx = await getActiveContext("inventory.manage_documents");
    if (ctx.error || !ctx.user || !ctx.accountId) {
      return { updated: 0, skipped: 0, error: ctx.error ?? "Не удалось определить контекст" };
    }
    const ids = Array.from(new Set(input.documentIds)).filter(Boolean);
    if (ids.length === 0) return { updated: 0, skipped: 0, error: "Не выбрано ни одного акта" };

    const admin = asLooseDb(createAdminClient());
    await assertAssignableUser({ admin, accountId: ctx.accountId, userId: input.userId });
    // Массиву id с клиента не доверяем: работаем только с актами, которые
    // пользователь реально видит (RLS documents_select).
    const visible = await filterVisibleDocumentIds({ supabase: ctx.supabase, documentIds: ids });
    const visibleIds = ids.filter((id) => visible.has(id));
    if (visibleIds.length === 0) return { updated: 0, skipped: ids.length, error: "Акты не найдены" };

    const { data: docsRaw, error: readError } = await admin
      .from<
        Array<{
          id: string;
          status: string;
          assigned_to: string | null;
          reviewer_id: string | null;
          document_number: string;
          venue_id: string | null;
        }>
      >("documents")
      .select("id, status, assigned_to, reviewer_id, document_number, venue_id")
      .eq("account_id", ctx.accountId)
      .in("id", visibleIds);
    // Codex P1 #407: read-ошибку нельзя глотать — иначе ложный успех.
    if (readError) throw new Error(readError.message);
    const docs = docsRaw ?? [];
    // Пропускаем залоченные по статусу для соответствующей роли (исполнитель
    // строже: лок уже на ready_for_review/results_blocked; проверяющий — лишь
    // на processed/sync_error) и no-op'ы, где значение уже стоит — чтобы не
    // плодить лог/уведомления на пустом месте (как single-action).
    const eligible = docs.filter((d) => {
      const lock =
        input.role === "assignee"
          ? getAssigneeLockReason(d.status)
          : getReviewerLockReason(d.status);
      if (lock !== null) return false;
      return input.role === "assignee"
        ? d.assigned_to !== input.userId
        : d.reviewer_id !== input.userId;
    });
    const skipped = ids.length - eligible.length;
    if (eligible.length === 0) return { updated: 0, skipped, error: null };

    const eligibleIds = eligible.map((d) => d.id);
    if (input.role === "reviewer") {
      const { error } = await admin
        .from("documents")
        .update({ reviewer_id: input.userId })
        .eq("account_id", ctx.accountId)
        .in("id", eligibleIds);
      if (error) throw new Error(error.message);
    } else {
      // Исполнитель: статус зависит от текущего (на пересчёте — сохраняем
      // recount_pending). Группируем по целевому статусу и обновляем пачками.
      const byStatus = new Map<string, string[]>();
      for (const d of eligible) {
        const next = nextStatusAfterAssign(d.status, input.userId);
        const arr = byStatus.get(next) ?? [];
        arr.push(d.id);
        byStatus.set(next, arr);
      }
      for (const [next, idsForStatus] of byStatus) {
        const { error } = await admin
          .from("documents")
          .update({ assigned_to: input.userId, status: next })
          .eq("account_id", ctx.accountId)
          .in("id", idsForStatus);
        if (error) throw new Error(error.message);
      }
    }

    const name = await loadProfileFullName(admin, input.userId);
    const eventType = input.role === "assignee" ? "assignee_changed" : "reviewer_changed";
    const setMsg =
      input.role === "assignee"
        ? `Назначил исполнителя: ${name ?? "сотрудник"}`
        : `Назначил проверяющего: ${name ?? "сотрудник"}`;
    const clearMsg = input.role === "assignee" ? "Снял исполнителя" : "Снял проверяющего";
    for (const d of eligible) {
      await writeInventoryResultEvent({
        supabase: ctx.supabase,
        admin,
        accountId: ctx.accountId,
        userId: ctx.user.id,
        documentId: d.id,
        eventType,
        message: input.userId ? setMsg : clearMsg,
        payload: {
          bulk: true,
          ...(input.role === "assignee" ? { assignedTo: input.userId } : { reviewerId: input.userId }),
        },
      });
    }

    // Одно суммарное уведомление назначенному (ссылка на список, не на акт).
    if (input.userId && input.userId !== ctx.user.id) {
      try {
        await admin.from("notifications").insert({
          user_id: input.userId,
          venue_id: eligible[0]?.venue_id ?? null,
          type:
            input.role === "assignee"
              ? "inventory.document.assigned"
              : "inventory.document.review_assigned",
          category: "inventory",
          title:
            input.role === "assignee"
              ? `Вам назначено актов: ${eligible.length}`
              : `Вы назначены проверяющим по актам: ${eligible.length}`,
          body: "Откройте раздел «Акты инвентаризации».",
          link: "/documents/inventory",
          actor_user_id: ctx.user.id,
          entity_type: "inventory_document",
          entity_id: null,
        });
      } catch (e) {
        console.error("[bulkAssignInventoryDocuments] notification threw:", e);
      }
    }

    revalidatePath("/documents/inventory");
    return { updated: eligible.length, skipped, error: null };
  } catch (e) {
    return { updated: 0, skipped: 0, error: actionErrorMessage(e, "Не удалось применить массовое действие") };
  }
}

/**
 * Удаление акта инвентаризации. Полное delete с каскадом по FK
 * (document_items → on delete cascade из миграции 122). Требуется
 * право inventory.manage_documents.
 *
 * Caveat для актов, синхронизированных с Quick Resto (external_id != null):
 * следующая синхронизация может вернуть удалённый акт. Это нормальное
 * поведение — Quick Resto источник истины. Хочешь убрать навсегда —
 * удаляй и в QR.
 */
export async function deleteInventoryDocument(input: {
  documentId: string;
}): Promise<{ error: string | null }> {
  try {
    const ctx = await getActiveContext("inventory.manage_documents");
    if (ctx.error || !ctx.accountId) {
      return { error: ctx.error ?? "Не удалось определить контекст" };
    }
    const admin = asLooseDb(createAdminClient());
    await assertDocumentVisible({ supabase: ctx.supabase, documentId: input.documentId });

    const { data: deleted, error } = await admin
      .from<Array<{ id: string }>>("documents")
      .delete()
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId)
      .neq("status", "processed")
      .is("results_snapshot_at", null)
      .select("id");
    if (error) return { error: error.message };
    // Ноль удалённых строк при видимом акте = сработало условие: акт успели
    // провести или зафиксировать.
    if ((deleted ?? []).length === 0) return { error: DELETE_BLOCKED_MESSAGE };
    revalidatePath("/documents/inventory");
    return { error: null };
  } catch (e) {
    console.error("[deleteInventoryDocument] unhandled error:", e);
    return {
      error:
        e instanceof Error && e.message
          ? e.message
          : "Не удалось удалить акт. Подробности в логах.",
    };
  }
}

/**
 * Массовое удаление актов (из плавающего bulk-бара). Право
 * inventory.manage_documents. Каскад по FK. Тот же caveat про QR, что и у
 * одиночного delete: QR-акты могут вернуться при следующей синхронизации.
 */
export async function bulkDeleteInventoryDocuments(input: {
  documentIds: string[];
}): Promise<{ deleted: number; error: string | null }> {
  try {
    const ctx = await getActiveContext("inventory.manage_documents");
    if (ctx.error || !ctx.accountId) {
      return { deleted: 0, error: ctx.error ?? "Не удалось определить контекст" };
    }
    const ids = Array.from(new Set(input.documentIds)).filter(Boolean);
    if (ids.length === 0) return { deleted: 0, error: "Не выбрано ни одного акта" };

    const admin = asLooseDb(createAdminClient());
    // Массиву id с клиента не доверяем: оставляем только те акты, которые
    // пользователь реально видит (RLS documents_select).
    const visible = await filterVisibleDocumentIds({ supabase: ctx.supabase, documentIds: ids });
    const visibleIds = ids.filter((id) => visible.has(id));
    if (visibleIds.length === 0) return { deleted: 0, error: "Акты не найдены" };

    const { data: deletedRows, error } = await admin
      .from<Array<{ id: string }>>("documents")
      .delete()
      .eq("account_id", ctx.accountId)
      .in("id", visibleIds)
      .neq("status", "processed")
      .is("results_snapshot_at", null)
      .select("id");
    if (error) return { deleted: 0, error: error.message };

    const deletedCount = (deletedRows ?? []).length;
    if (deletedCount === 0) return { deleted: 0, error: DELETE_BLOCKED_MESSAGE };

    revalidatePath("/documents/inventory");
    return {
      deleted: deletedCount,
      error:
        deletedCount < visibleIds.length
          ? `Пропущено проведённых актов: ${visibleIds.length - deletedCount}. ${DELETE_BLOCKED_MESSAGE}`
          : null,
    };
  } catch (e) {
    console.error("[bulkDeleteInventoryDocuments] unhandled error:", e);
    return {
      deleted: 0,
      error:
        e instanceof Error && e.message ? e.message : "Не удалось удалить акты. Подробности в логах.",
    };
  }
}

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

  const [{ data: canViewResults }, { data: canViewDocuments }, { data: canFill }] = await Promise.all([
    ctx.supabase.rpc("has_permission", { permission_code: "inventory.view_results" }),
    ctx.supabase.rpc("has_permission", { permission_code: "inventory.view_documents" }),
    ctx.supabase.rpc("has_permission", { permission_code: "inventory.fill_assigned_documents" }),
  ]);
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
  const allowed = Boolean(canViewDocuments) || (Boolean(canFill) && document.assigned_to === ctx.user.id);
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
      .from<{ id: string; assigned_to: string | null; reviewer_id: string | null; archived_at: string | null }>(
        "documents",
      )
      .select("id, assigned_to, reviewer_id, archived_at")
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!document?.id) throw new Error("Акт не найден");
    if (document.archived_at) throw new Error("Этот акт удалён в Quick Resto и недоступен для изменений.");

    const [{ data: canManage }, { data: canRecount }] = await Promise.all([
      ctx.supabase.rpc("has_permission", { permission_code: "inventory.manage_documents" }),
      ctx.supabase.rpc("has_permission", { permission_code: "inventory.recount_documents" }),
    ]);
    const canEdit =
      Boolean(canManage) ||
      document.assigned_to === ctx.user.id ||
      (document.reviewer_id === ctx.user.id && Boolean(canRecount));
    if (!canEdit) throw new Error("Недостаточно прав для редактирования комментария");

    const note = text(input.note);
    const { error } = await admin
      .from("documents")
      .update({ note })
      .eq("id", input.documentId)
      .eq("account_id", ctx.accountId);
    if (error) throw new Error(error.message);

    revalidatePath(`/documents/inventory/${input.documentId}/overview`);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось сохранить комментарий") };
  }
}

export async function setInventoryResultItemExcluded(input: {
  documentId: string;
  itemId: string;
  excluded: boolean;
  reason?: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.adjust_results"]);
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
    const { data: item } = await admin
      .from<{
        id: string;
        product_name: string;
        exclusion_rule_id: string | null;
        ingredient_id: string | null;
        external_product_id: string | null;
      }>("document_items")
      .select("id, product_name, exclusion_rule_id, ingredient_id, external_product_id")
      .eq("id", input.itemId)
      .eq("document_id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!item?.id) throw new Error("Строка акта не найдена");

    if (input.excluded) {
      const activeResortItemIds = await getActiveResortItemIds({
        admin,
        accountId: ctx.accountId,
        documentId: input.documentId,
        itemIds: [item.id],
      });
      if (activeResortItemIds.has(item.id)) {
        throw new Error("Строка уже участвует в активном пересорте. Сначала отмените пересорт.");
      }
    }

    // Ручное решение перебивает правило и держится: «Учитывать в этом акте» на
    // строке, исключённой правилом, ставит отметку об отказе — импорт такую
    // строку правилом больше не тронет (см. resolveExclusionState).
    const reason = input.excluded ? text(input.reason) : null;
    const now = new Date().toISOString();
    // Отменяем ДЕЙСТВУЮЩЕЕ правило, а не только записанное в строке: ручное
    // исключение сбрасывает происхождение, и по одному exclusion_rule_id
    // правило было бы не найти — импорт применил бы его заново.
    let dismissRuleId = item.exclusion_rule_id;
    if (!input.excluded && !dismissRuleId) {
      const matchRule = await loadActiveExclusionRuleMatcher({ admin, accountId: ctx.accountId });
      dismissRuleId = matchRule(item)?.id ?? null;
    }
    const { error } = await admin
      .from("document_items")
      .update(
        resolveManualExclusionState({
          excluded: input.excluded,
          reason,
          userId: ctx.user.id,
          now,
          currentRuleId: dismissRuleId,
        }),
      )
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
      eventType: input.excluded ? "exclude_enabled" : "exclude_disabled",
      message: input.excluded
        ? `Позиция «${item.product_name}» исключена из управленческих итогов`
        : `Позиция «${item.product_name}» возвращена в управленческие итоги`,
      payload: { itemId: item.id, productName: item.product_name, reason },
    });

    revalidateInventoryResultPages(input.documentId);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось изменить учет строки") };
  }
}

export async function createInventoryResultExclusionRule(input: {
  documentId: string;
  itemId: string;
  reason?: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.adjust_results"]);
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
    const { data: item } = await admin
      .from<InventoryResultItemRow>("document_items")
      .select("id, document_id, account_id, ingredient_id, external_product_id, product_name, measure_unit_id, measure_unit_name, difference_amount, difference_sum, excluded_from_totals")
      .eq("id", input.itemId)
      .eq("document_id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!item?.id) throw new Error("Строка акта не найдена");
    if (!item.ingredient_id && !item.external_product_id) {
      throw new Error("У строки нет QR ID продукта, автоисключение создать нельзя.");
    }

    const activeResortItemIds = await getActiveResortItemIds({
      admin,
      accountId: ctx.accountId,
      documentId: input.documentId,
      itemIds: [item.id],
    });
    if (activeResortItemIds.has(item.id)) {
      throw new Error("Строка уже участвует в активном пересорте. Сначала отмените пересорт.");
    }

    let existingRuleQuery = admin
      .from<InventoryExclusionRuleLookup>("inventory_result_exclusion_rules")
      .select("id, ingredient_id, external_product_id, reason, created_by, created_at")
      .eq("account_id", ctx.accountId)
      .eq("status", "active");
    if (item.ingredient_id) {
      existingRuleQuery = existingRuleQuery.eq("ingredient_id", item.ingredient_id);
    } else {
      existingRuleQuery = existingRuleQuery.eq("external_product_id", item.external_product_id);
    }
    const { data: existingRule } = await existingRuleQuery.maybeSingle();

    const reason = text(input.reason);
    const { data: rule, error: ruleError } = existingRule?.id
      ? { data: existingRule, error: null }
      : await admin
          .from<InventoryExclusionRuleLookup>("inventory_result_exclusion_rules")
          .insert({
            account_id: ctx.accountId,
            ingredient_id: item.ingredient_id,
            external_product_id: item.external_product_id,
            product_name: item.product_name,
            reason,
            created_by: ctx.user.id,
          })
          .select("id, ingredient_id, external_product_id, reason, created_by, created_at")
          .single();
    if (ruleError || !rule?.id) throw new Error(ruleError?.message ?? "Не удалось создать правило автоисключения");

    const now = new Date().toISOString();
    const { error: itemError } = await admin
      .from("document_items")
      .update({
        excluded_from_totals: true,
        exclude_reason: reason,
        excluded_by: ctx.user.id,
        excluded_at: now,
        exclusion_rule_id: rule.id,
        exclusion_rule_dismissed_at: null,
      })
      .eq("id", item.id)
      .eq("account_id", ctx.accountId);
    if (itemError) throw new Error(itemError.message);

    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: input.documentId,
      documentItemId: item.id,
      eventType: "persistent_exclusion_enabled",
      message: `Позиция «${item.product_name}» добавлена в автоисключения`,
      payload: {
        itemId: item.id,
        productName: item.product_name,
        ruleId: rule.id,
        reason,
      },
    });

    revalidateInventoryResultPages(input.documentId);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось создать автоисключение") };
  }
}

export async function deleteInventoryResultExclusionRule(input: {
  documentId: string;
  itemId: string;
  reason: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.adjust_results"]);
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
    const reason = normalizeReason(input.reason, "Укажите причину удаления автоисключения");
    const { data: item } = await admin
      .from<InventoryResultItemRow>("document_items")
      .select("id, document_id, account_id, ingredient_id, external_product_id, product_name, measure_unit_id, measure_unit_name, difference_amount, difference_sum, excluded_from_totals")
      .eq("id", input.itemId)
      .eq("document_id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!item?.id) throw new Error("Строка акта не найдена");

    let ruleQuery = admin
      .from<{ id: string }>("inventory_result_exclusion_rules")
      .select("id")
      .eq("account_id", ctx.accountId)
      .eq("status", "active");
    if (item.ingredient_id) {
      ruleQuery = ruleQuery.eq("ingredient_id", item.ingredient_id);
    } else if (item.external_product_id) {
      ruleQuery = ruleQuery.eq("external_product_id", item.external_product_id);
    } else {
      throw new Error("Автоисключение не найдено");
    }
    const { data: rule } = await ruleQuery.maybeSingle();
    if (!rule?.id) throw new Error("Автоисключение не найдено");

    const { error: ruleError } = await admin
      .from("inventory_result_exclusion_rules")
      .update({
        status: "deleted",
        deleted_by: ctx.user.id,
        deleted_at: new Date().toISOString(),
        delete_reason: reason,
      })
      .eq("id", rule.id)
      .eq("account_id", ctx.accountId);
    if (ruleError) throw new Error(ruleError.message);

    // Снимаем исключение со ВСЕХ строк, которые исключило это правило, а не
    // только в открытом акте. Раньше в остальных актах позиция оставалась
    // исключённой навсегда — и уже неотличимо от ручного решения, потому что
    // правила, которое её исключило, больше нет.
    const { data: clearedRows, error: itemError } = await admin
      .from<Array<{ id: string; document_id: string }>>("document_items")
      .update({
        excluded_from_totals: false,
        exclude_reason: null,
        excluded_by: null,
        excluded_at: null,
        exclusion_rule_id: null,
        exclusion_rule_dismissed_at: null,
      })
      .eq("account_id", ctx.accountId)
      .eq("exclusion_rule_id", rule.id)
      .select("id, document_id");
    if (itemError) throw new Error(itemError.message);
    const clearedDocumentIds = Array.from(
      new Set((clearedRows ?? []).map((row) => row.document_id)),
    );

    // Строку, исключённую ВРУЧНУЮ, удаление правила не трогает: её исключал
    // человек, а не правило. Раньше здесь стоял безусловный UPDATE по текущей
    // строке — он снимал и ручное решение тоже. Строки, которые исключило это
    // правило, уже сняты запросом выше; легаси-строки без происхождения
    // размечены бэкфиллом миграции 231.
    const clearedCurrentItem = (clearedRows ?? []).some((row) => row.id === item.id);

    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: input.documentId,
      documentItemId: item.id,
      eventType: "persistent_exclusion_disabled",
      message: !clearedCurrentItem
        ? `Автоисключение позиции «${item.product_name}» удалено (в этом акте позиция исключена вручную и осталась исключённой)`
        : clearedDocumentIds.length > 1
          ? `Автоисключение позиции «${item.product_name}» удалено (позиция вернулась в итоги в ${clearedDocumentIds.length} актах)`
          : `Автоисключение позиции «${item.product_name}» удалено`,
      payload: {
        itemId: item.id,
        productName: item.product_name,
        ruleId: rule.id,
        reason,
        clearedDocumentIds,
      },
    });

    // Правило действовало на весь аккаунт, поэтому обновляем страницы всех
    // затронутых актов, а не только открытого.
    for (const documentId of new Set([input.documentId, ...clearedDocumentIds])) {
      revalidateInventoryResultPages(documentId);
    }
    revalidatePath("/documents/inventory");
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось удалить автоисключение") };
  }
}

export async function createInventoryResultResort(input: {
  documentId: string;
  itemIds: string[];
  reason?: string;
  suggestionSource?: "manual" | "history" | "ai";
  suggestionConfidence?: number | null;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.adjust_results"]);
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
    const reason = text(input.reason) ?? "Ручной пересорт";
    const itemIds = Array.from(new Set(input.itemIds));
    const items = await loadResultItemsForAdjustment({
      admin,
      accountId: ctx.accountId,
      documentId: input.documentId,
      itemIds,
    });
    if (items.some((item) => item.excluded_from_totals)) {
      throw new Error("Исключенные строки нельзя добавить в пересорт.");
    }

    const activeResortItemIds = await getActiveResortItemIds({
      admin,
      accountId: ctx.accountId,
      documentId: input.documentId,
      itemIds,
    });
    if (activeResortItemIds.size > 0) {
      throw new Error("Одна или несколько строк уже участвуют в активном пересорте.");
    }

    const group = await resolveResultItemGroup({
      admin,
      accountId: ctx.accountId,
      items,
    });
    const measureUnitKeys = new Set(items.map(resultItemMeasureKey));
    if (measureUnitKeys.size !== 1) {
      throw new Error("Для пересорта можно выбрать позиции только одной единицы измерения");
    }
    const measureUnitKey = Array.from(measureUnitKeys)[0];

    const allocation = calculateResortAllocation(
      items.map((item) => ({
        id: item.id,
        groupId: group.id,
        measureUnitKey,
        differenceAmount: num(item.difference_amount),
        differenceSum: num(item.difference_sum),
      })),
    );
    const itemById = new Map(items.map((item) => [item.id, item]));
    const sourceShortfallSum = items
      .map((item) => num(item.difference_sum) ?? 0)
      .filter((value) => value < 0)
      .reduce((total, value) => total + value, 0);
    const sourceSurplusSum = items
      .map((item) => num(item.difference_sum) ?? 0)
      .filter((value) => value > 0)
      .reduce((total, value) => total + value, 0);

    const { data: resort, error: resortError } = await admin
      .from<{ id: string }>("inventory_result_resorts")
      .insert({
        account_id: ctx.accountId,
        document_id: input.documentId,
        group_id: group.id,
        group_name: group.name,
        measure_unit_key: measureUnitKey,
        reason,
        offset_amount: allocation.offsetAmount,
        residual_shortfall_sum: allocation.residualShortfallSum,
        residual_surplus_sum: allocation.residualSurplusSum,
        source_shortfall_sum: sourceShortfallSum,
        source_surplus_sum: sourceSurplusSum,
        // Корректировка себестоимости (миграция 205): если недостача
        // дороже излишка — управленческий убыток на разнице цен. См.
        // docs/handbook/inventory/resort.md.
        cost_adjustment_sum: allocation.costAdjustmentSum,
        suggestion_source: input.suggestionSource ?? "manual",
        suggestion_confidence: typeof input.suggestionConfidence === "number" ? input.suggestionConfidence : null,
        created_by: ctx.user.id,
        metadata: { itemIds },
      })
      .select("id")
      .single();
    if (resortError || !resort?.id) throw new Error(resortError?.message ?? "Не удалось создать пересорт");

    const resortRows = allocation.items.map((allocationItem: InventoryResortAllocationItem) => {
      const item = itemById.get(allocationItem.id);
      if (!item) throw new Error("Строка пересорта не найдена");
      return {
        account_id: ctx.accountId,
        resort_id: resort.id,
        document_id: input.documentId,
        document_item_id: item.id,
        ingredient_id: item.ingredient_id,
        external_product_id: item.external_product_id,
        product_name: item.product_name,
        role: allocationItem.role,
        source_difference_amount: allocationItem.sourceDifferenceAmount,
        source_difference_sum: allocationItem.sourceDifferenceSum,
        offset_amount: allocationItem.offsetAmount,
        remaining_difference_amount: allocationItem.remainingDifferenceAmount,
        remaining_difference_sum: allocationItem.remainingDifferenceSum,
        snapshot: item,
      };
    });
    const { error: itemsError } = await admin.from("inventory_result_resort_items").insert(resortRows);
    if (itemsError) {
      // Компенсация: откатываем шапку пересорта. В supabase-js нет вложенной
      // транзакции, поэтому при сбое вставки строк иначе остался бы активный
      // пересорт без строк (битый итог). Полная атомарность через RPC —
      // см. backlog B7 в плане ревью.
      await admin
        .from("inventory_result_resorts")
        .delete()
        .eq("id", resort.id)
        .eq("account_id", ctx.accountId);
      throw new Error(itemsError.message);
    }

    // Пересорт снимает отметку «на пересчёт» с вошедших строк: если позицию
    // свели в пересорт, перепроверять её отдельным пересчётом уже не нужно.
    // Зеркалит cleanup recount-флагов в submitInventoryDocumentDraft.
    await admin
      .from("document_items")
      .update({
        needs_recount: false,
        recount_auto_flagged: false,
        recount_marked_by: null,
        recount_marked_at: null,
        recount_note: null,
      })
      .eq("document_id", input.documentId)
      .eq("account_id", ctx.accountId)
      .in("id", itemIds);

    const shortfallItems = resortRows.filter((row) => row.role === "shortage");
    const surplusItems = resortRows.filter((row) => row.role === "surplus");
    const describeResortItem = (row: (typeof resortRows)[number]) =>
      `${row.product_name} (${row.source_difference_amount > 0 ? "+" : ""}${row.source_difference_amount})`;
    const shortfallText = shortfallItems.map(describeResortItem).join(", ");
    const surplusText = surplusItems.map(describeResortItem).join(", ");
    const resortMessage =
      surplusText && shortfallText
        ? `Пересорт: ${surplusText} зачтено на ${shortfallText}`
        : `Создан пересорт: ${items.map((item) => item.product_name).join(", ")}`;

    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: input.documentId,
      resortId: resort.id,
      eventType: "resort_created",
      message: resortMessage,
      payload: {
        resortId: resort.id,
        itemIds,
        reason,
        source: input.suggestionSource ?? "manual",
        offsetAmount: allocation.offsetAmount,
        residualShortfallSum: allocation.residualShortfallSum,
        residualSurplusSum: allocation.residualSurplusSum,
        items: resortRows.map((row) => ({
          documentItemId: row.document_item_id,
          productName: row.product_name,
          role: row.role,
          sourceDifferenceAmount: row.source_difference_amount,
          sourceDifferenceSum: row.source_difference_sum,
          offsetAmount: row.offset_amount,
          remainingDifferenceAmount: row.remaining_difference_amount,
          remainingDifferenceSum: row.remaining_difference_sum,
        })),
      },
    });

    if (input.suggestionSource && input.suggestionSource !== "manual") {
      await writeInventoryResultEvent({
        supabase: ctx.supabase,
        admin,
        accountId: ctx.accountId,
        userId: ctx.user.id,
        documentId: input.documentId,
        resortId: resort.id,
        eventType: "suggestion_applied",
        message: `Принята подсказка пересорта (${input.suggestionSource === "ai" ? "AI" : "история"})`,
        payload: {
          resortId: resort.id,
          itemIds,
          source: input.suggestionSource,
          confidence: typeof input.suggestionConfidence === "number" ? input.suggestionConfidence : null,
          reason,
        },
      });
    }

    revalidateInventoryResultPages(input.documentId);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось создать пересорт") };
  }
}

export async function voidInventoryResultResort(input: {
  documentId: string;
  resortId: string;
  reason: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.adjust_results"]);
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
    const reason = normalizeReason(input.reason, "Укажите причину отмены пересорта");
    const { data: resort } = await admin
      .from<{ id: string; status: string }>("inventory_result_resorts")
      .select("id, status")
      .eq("id", input.resortId)
      .eq("document_id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!resort?.id) throw new Error("Пересорт не найден");
    if (resort.status !== RESORT_STATUS.active) throw new Error("Пересорт уже отменен");

    const { error } = await admin
      .from("inventory_result_resorts")
      .update({
        status: RESORT_STATUS.voided,
        voided_by: ctx.user.id,
        voided_at: new Date().toISOString(),
        void_reason: reason,
      })
      .eq("id", resort.id)
      .eq("account_id", ctx.accountId);
    if (error) throw new Error(error.message);

    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: input.documentId,
      resortId: resort.id,
      eventType: "resort_voided",
      message: "Пересорт отменен",
      payload: { resortId: resort.id, reason },
    });

    revalidateInventoryResultPages(input.documentId);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось отменить пересорт") };
  }
}

export async function dismissInventoryResortSuggestion(input: {
  documentId: string;
  key: string;
  itemIds: string[];
  source: "history" | "ai";
  confidence: number | null;
  reason: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.adjust_results"]);
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
    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: input.documentId,
      eventType: "suggestion_dismissed",
      message: `Подсказка пересорта отклонена: ${input.reason}`,
      payload: {
        key: input.key,
        itemIds: input.itemIds,
        source: input.source,
        confidence: input.confidence,
        reason: input.reason,
      },
    });

    revalidateInventoryResultPages(input.documentId);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось скрыть подсказку") };
  }
}

/**
 * AI-подсказки пересорта «по запросу» (кнопка на «Итогах»). Раньше DeepSeek
 * вызывался синхронно при рендере и тормозил открытие акта — теперь только по
 * клику. История-подсказки остаются на серверном рендере (дёшево).
 * Гейт: adjust_results + lock-гард + право use_ai_suggestions + флаг аккаунта.
 */
export async function getAiResortSuggestions(input: {
  documentId: string;
}): Promise<{ suggestions: ResortSuggestion[]; error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.adjust_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { suggestions: [], error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    await getResultDocumentForAction({
      admin,
      supabase: ctx.supabase,
      accountId: ctx.accountId,
      documentId: input.documentId,
      requireOpen: true,
    });

    const { data: canUseAi } = await ctx.supabase.rpc("has_permission", {
      permission_code: "inventory.use_ai_suggestions",
    });
    const { data: account } = await admin
      .from<{ inventory_ai_suggestions_enabled: boolean | null }>("accounts")
      .select("inventory_ai_suggestions_enabled")
      .eq("id", ctx.accountId)
      .maybeSingle();
    if (!canUseAi || !account?.inventory_ai_suggestions_enabled) {
      return { suggestions: [], error: null };
    }

    const { data: itemsRaw } = await admin
      .from<
        Array<{
          id: string;
          ingredient_id: string | null;
          product_name: string;
          measure_unit_id: number | null;
          measure_unit_name: string | null;
          difference_amount: number | null;
          difference_sum: number | null;
          excluded_from_totals: boolean | null;
        }>
      >("document_items")
      .select(
        "id, ingredient_id, product_name, measure_unit_id, measure_unit_name, difference_amount, difference_sum, excluded_from_totals",
      )
      .eq("account_id", ctx.accountId)
      .eq("document_id", input.documentId);
    const items = itemsRaw ?? [];

    const ingredientIds = items.map((item) => item.ingredient_id).filter((id): id is string => Boolean(id));
    const { data: products } = ingredientIds.length > 0
      ? await admin
          .from<Array<{ id: string; group_id: string | null }>>("ingredients")
          .select("id, group_id")
          .eq("account_id", ctx.accountId)
          .in("id", ingredientIds)
      : { data: [] };
    const groupByProductId = new Map((products ?? []).map((product) => [product.id, product.group_id]));
    const groupIds = Array.from(
      new Set((products ?? []).map((product) => product.group_id).filter((id): id is string => Boolean(id))),
    );
    const { data: groups } = groupIds.length > 0
      ? await admin
          .from<Array<{ id: string; name: string }>>("ingredient_groups")
          .select("id, name")
          .eq("account_id", ctx.accountId)
          .in("id", groupIds)
      : { data: [] };
    const groupNameById = new Map((groups ?? []).map((group) => [group.id, group.name]));

    const currentItems: AiSuggestionSourceItem[] = items.map((item) => {
      const groupId = item.ingredient_id ? groupByProductId.get(item.ingredient_id) ?? null : null;
      return {
        id: item.id,
        product_name: item.product_name,
        group_id: groupId,
        group_name: groupId ? groupNameById.get(groupId) ?? null : null,
        measure_unit_id: item.measure_unit_id,
        measure_unit_name: item.measure_unit_name,
        difference_amount: item.difference_amount,
        difference_sum: item.difference_sum,
        excluded_from_totals: item.excluded_from_totals,
      };
    });

    const activeResortItemIds = await getActiveResortItemIds({
      admin,
      accountId: ctx.accountId,
      documentId: input.documentId,
    });

    const { data: events } = await admin
      .from<Array<{ payload: Record<string, unknown> | null }>>("inventory_result_events")
      .select("payload")
      .eq("account_id", ctx.accountId)
      .eq("document_id", input.documentId)
      .eq("event_type", "suggestion_dismissed");
    const dismissed = new Set(
      (events ?? [])
        .map((event) => (event.payload && typeof event.payload === "object" ? event.payload.key : null))
        .filter((key): key is string => typeof key === "string" && key.length > 0),
    );

    const suggestions = (
      await buildAiSuggestions({ enabled: true, currentItems, activeResortItemIds })
    ).filter((suggestion) => !dismissed.has(suggestion.key));

    return { suggestions, error: null };
  } catch (error) {
    return { suggestions: [], error: actionErrorMessage(error, "Не удалось получить подсказки ИИ") };
  }
}

export async function finalizeInventoryResults(input: {
  documentId: string;
}): Promise<{ error: string | null; notice?: string }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.finalize_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    const document = await getResultDocumentForAction({
      admin,
      supabase: ctx.supabase,
      accountId: ctx.accountId,
      documentId: input.documentId,
    });
    // Уже финализирован — no-op. NB: ТОЛЬКО results_finalized_at, не status.
    // reopenInventoryResults очищает results_finalized_at, но НЕ меняет status
    // (остаётся 'processed'); UI после reopen снова показывает «Подвести
    // итоги». Если гейтить и по status='processed', повторная финализация
    // тихо проглатывалась бы как успех — акт оставался в editable-режиме
    // навсегда (Codex P2).
    if (document.results_finalized_at) return { error: null };
    // Финализировать можно только сданный акт. До сдачи итогов не существует:
    // факт нулевой, и разница из Quick Resto равна минус всему складскому
    // остатку — проведение списало бы его целиком (прод-кейс на 478 193,6 ₽).
    // Кнопки в UI нет (страница итогов гейтится тем же предикатом), но экшен
    // вызываем напрямую, а это самое разрушительное действие модуля.
    if (!hasCountedResults(document.status)) {
      return {
        error:
          "Подсчёт ещё не завершён — подвести итоги можно после того, как исполнитель сдаст акт.",
      };
    }
    // Акт на пересчёте закрыть нельзя — сначала исполнитель должен завершить
    // пересчёт (статус вернётся в ready_for_review).
    if (document.status === "recount_pending") {
      return {
        error:
          "Акт отправлен на пересчёт. Дождитесь, пока исполнитель завершит пересчёт, прежде чем финализировать итоги.",
      };
    }

    // QR — источник правды для проведения акта. Сначала push в QR
    // (backoffice action /warehouse.inventory.document.v2/action,
    // actionName=process), и только при успехе обновляем локально:
    // status=processed + processed=true + results_finalized_at. На фейле QR
    // (нет коннекта / 5xx / отказ) локально НИЧЕГО не меняем — юзер видит
    // ошибку, может починить и попробовать заново. Следующий pull-sync
    // в любом случае подтянет реальное состояние из QR.
    const connection = await getConnection(ctx.accountId);
    if (!connection) {
      return {
        error:
          "Quick Resto не подключён — нельзя провести акт. Подключите интеграцию в настройках.",
      };
    }
    const externalIdNum = Number(document.external_id);
    if (!Number.isFinite(externalIdNum)) {
      return { error: "Не удалось определить ID акта в Quick Resto." };
    }
    const apiAuth = {
      layerName: connection.login,
      login: connection.login,
      password: connectionPassword(connection),
    };

    // Guard от «тихого успеха»: акт мог быть удалён в QR (или его там нет).
    // На удалённом акте /action отвечает 200 и НИЧЕГО не делает — без этой
    // проверки мы бы впустую пометили акт проведённым локально. Читаем акт
    // из QR перед проведением: если удалён / не найден — явная ошибка, локально
    // ничего не трогаем. (См. инцидент: финализация СВ-акта, удалённого в QR.)
    let qrDocBefore: QuickRestoInventoryDocument2;
    try {
      qrDocBefore = await readInventoryDocument({ ...apiAuth, objectId: externalIdNum });
    } catch (readError) {
      console.error("[finalize] QR read failed (акт удалён в QR?)", {
        documentId: document.id,
        externalId: externalIdNum,
        error: readError,
      });
      return {
        error:
          "Не удалось прочитать акт в Quick Resto — возможно, он удалён. Обновите синхронизацию и проверьте акт.",
      };
    }
    if (isDeletedQuickRestoRow(qrDocBefore)) {
      return {
        error:
          "Этот акт удалён в Quick Resto — провести его нельзя. Обновите синхронизацию.",
      };
    }

    // Полусбойное состояние: в Quick Resto акт уже проведён, а локально
    // финализация не доехала. Так бывает, когда /action отработал, а
    // постусловное чтение упало по таймауту: экшен вернул ошибку и НЕ тронул
    // documents. Повторное нажатие «Подвести итоги» не должно проводить
    // проведённый акт — вместо этого дописываем локальное состояние.
    //
    // Сверку перед проведением в этом случае пропускаем сознательно: у
    // проведённого акта Quick Resto отдаёт уже ПОСЛЕ-проведенческие расчётные
    // остатки, сверка нашла бы «расхождение» с утверждёнными числами и
    // заблокировала бы финализацию навсегда. Утверждённое — то, что лежит в
    // строках сейчас; его и фиксируем.
    const alreadyProcessedInQr = Boolean(qrDocBefore.processed);

    // Сверка перед проведением. Между тем моментом, когда проверяющий смотрел
    // «Итоги», и нажатием «Подвести итоги» Quick Resto мог пересчитать
    // расчётные остатки (правки в учёте за период до даты акта). Тогда
    // утверждают одни числа, а проводятся другие — так и вышло с СВ340:
    // на экране был итог +89,25 ₽, провелось +16 301,75 ₽.
    // Поэтому: перечитываем строки, и если они разъехались — НЕ проводим,
    // а показываем разницу и просим подтвердить ещё раз.
    const readResultLines = async (): Promise<InventoryRecheckLine[]> => {
      const { data } = await admin
        .from<Array<{ external_item_id: string; difference_amount: number | null; difference_sum: number | null }>>(
          "document_items",
        )
        .select("external_item_id, difference_amount, difference_sum")
        .eq("account_id", ctx.accountId)
        .eq("document_id", document.id);
      return (data ?? []).map((row) => ({
        externalItemId: row.external_item_id,
        differenceAmount: row.difference_amount,
        differenceSum: row.difference_sum,
      }));
    };

    let recheckSkippedReason: string | null = alreadyProcessedInQr
      ? "акт уже проведён в Quick Resto"
      : null;
    // Проведённый акт не сверяем (см. alreadyProcessedInQr выше).
    if (!alreadyProcessedInQr) {
      try {
        const linesBefore = await readResultLines();
        const freshItems = await listBackOfficeInventoryItemsWithSession({
          connection,
          admin,
          documentExternalId: externalIdNum,
        });
        if (freshItems.length === 0) {
          recheckSkippedReason = "Quick Resto не вернул позиции для сверки";
        } else {
          await refreshLocalInventoryDocumentFromPayload({
            admin,
            accountId: ctx.accountId,
            documentId: document.id,
            document: { ...qrDocBefore, effectedItems: freshItems },
            // Статус не двигаем: сверка — это обновление данных, а не переход
            // по статусной машине.
            status: document.status,
          });
          const diff = compareResultLines(linesBefore, await readResultLines());
          if (hasResultDrift(diff)) {
            console.info("[finalize] данные QR разъехались, проведение отменено", {
              documentId: document.id,
              changed: diff.changedLines,
              beforeTotal: diff.beforeTotal,
              afterTotal: diff.afterTotal,
            });
            await writeInventoryResultEvent({
              supabase: ctx.supabase,
              admin,
              accountId: ctx.accountId,
              userId: ctx.user.id,
              documentId: document.id,
              eventType: "results_recheck_drift",
              message: "Данные Quick Resto изменились перед проведением",
              payload: {
                changedLines: diff.changedLines,
                addedLines: diff.addedLines,
                removedLines: diff.removedLines,
                beforeTotal: diff.beforeTotal,
                afterTotal: diff.afterTotal,
              },
            });
            revalidateInventoryResultPages(document.id);
            return { error: describeResultDrift(diff) };
          }
        }
      } catch (recheckError) {
        // Сверка — защита, а не предусловие: если backoffice недоступен, не
        // блокируем проведение, но оставляем след в журнале.
        console.error("[finalize] сверка перед проведением не выполнена", {
          documentId: document.id,
          error: recheckError,
        });
        recheckSkippedReason = "Quick Resto недоступен для сверки";
      }
    }

    // Снимок построчных итогов — ДО обращения к QR. «Расчёт» и «Разница» в
    // строках приходят из QR и пересчитываются им по движениям товара, поэтому
    // фиксируем ровно то, что утвердил проверяющий (миграция 221). Если снимок
    // не снялся — выходим, не проведя акт: лучше ничего не делать, чем провести
    // и остаться без зафиксированных итогов.
    const { error: snapshotError } = await admin.rpc("freeze_inventory_result_snapshot", {
      p_account_id: ctx.accountId,
      p_document_id: document.id,
    });
    if (snapshotError) {
      console.error("[finalize] snapshot failed", {
        documentId: document.id,
        error: snapshotError,
      });
      return { error: "Не удалось зафиксировать итоги акта. Попробуйте ещё раз." };
    }

    // Снимок снят, а documents.results_snapshot_at выставится только в самом
    // конце. Если дальше что-то упадёт, строки останутся помечены finalized_*,
    // но страница продолжит показывать живые значения (акт не залочен) —
    // состояние корректное, но должно быть видно в логах.
    const logOrphanSnapshot = (reason: string) => {
      console.warn("[finalize] снимок строк снят, но акт не зафиксирован", {
        documentId: document.id,
        externalId: externalIdNum,
        reason,
      });
    };

    if (!alreadyProcessedInQr) {
      try {
        await processBackOfficeInventoryDocumentWithSession({
          connection,
          admin,
          documentExternalId: externalIdNum,
        });
        console.info("[finalize] QR processed", {
          documentId: document.id,
          externalId: externalIdNum,
        });
      } catch (qrError) {
        const message =
          qrError instanceof Error ? qrError.message : "Quick Resto не ответил";
        console.error("[finalize] QR process failed", {
          documentId: document.id,
          externalId: externalIdNum,
          error: qrError,
        });
        logOrphanSnapshot("проведение в Quick Resto не удалось");
        return { error: `Не удалось провести акт в Quick Resto: ${message}` };
      }
    }

    // Постусловие: убеждаемся, что QR реально провёл акт. /action на удалённом /
    // изменённом акте может тихо вернуть 200 ничего не сделав — тогда локально
    // НЕ помечаем проведённым, иначе разъедемся с QR (источник правды).
    let qrDocAfter: QuickRestoInventoryDocument2 | null = alreadyProcessedInQr
      ? qrDocBefore
      : null;
    if (!alreadyProcessedInQr) {
      try {
        qrDocAfter = await readInventoryDocument({ ...apiAuth, objectId: externalIdNum });
        if (!qrDocAfter.processed) {
          console.error("[finalize] QR не отметил акт проведённым после process", {
            documentId: document.id,
            externalId: externalIdNum,
          });
          logOrphanSnapshot("Quick Resto не отметил акт проведённым");
          return {
            error:
              "Quick Resto не отметил акт проведённым. Возможно, акт удалён или изменён — обновите синхронизацию и попробуйте снова.",
          };
        }
      } catch (verifyError) {
        console.error("[finalize] QR re-read after process failed", {
          documentId: document.id,
          externalId: externalIdNum,
          error: verifyError,
        });
        logOrphanSnapshot("не удалось подтвердить проведение");
        return {
          error:
            "Не удалось подтвердить проведение акта в Quick Resto. Обновите синхронизацию и проверьте статус акта.",
        };
      }
    }

    const finalizedAt = new Date().toISOString();
    // Суммы акта (колонка «Сумма итогов» в списке) Quick Resto заполняет
    // ТОЛЬКО у проведённого акта: до проведения public-payload отдаёт нули,
    // а мы читали акт именно до. Поэтому по всем актам в списке стояло 0
    // (прод: СВ340 — 0 против 16 301,75 ₽ в QR). Берём их из ответа, которым
    // только что подтвердили проведение; если QR не прислал числа, оставляем
    // прежние значения, а не затираем нулями.
    const qrShortfallSum = num(qrDocAfter?.shortfallSum);
    const qrSurplusSum = num(qrDocAfter?.surplusSum);
    const { error } = await admin
      .from("documents")
      .update({
        status: "processed",
        processed: true,
        ...(qrShortfallSum !== null ? { qr_shortfall_sum: qrShortfallSum } : {}),
        ...(qrSurplusSum !== null ? { qr_surplus_sum: qrSurplusSum } : {}),
        results_finalized_at: finalizedAt,
        results_finalized_by: ctx.user.id,
        // Акт снова проведён — метка «распровели в Quick Resto» (миграция 224)
        // больше не актуальна. Синхронизация её не снимет: она ходит только по
        // НЕпроведённым актам.
        qr_unprocessed_at: null,
        // Включает снимок строк (finalized_* выше) — с этого момента страница
        // итогов показывает зафиксированные числа, а не живые из Quick Resto.
        results_snapshot_at: finalizedAt,
        // Сбрасываем reopened-метки: если это была повторная финализация после
        // reopen, акт должен снова залочиться (isLocked на странице итогов
        // считает реопен-флаг → editable). Без сброса UI остался бы editable.
        results_reopened_at: null,
        results_reopened_by: null,
        // Авто-фоллбэк: финализирующий становится проверяющим, если поле пусто.
        ...(document.reviewer_id ? {} : { reviewer_id: ctx.user.id }),
      })
      .eq("id", document.id)
      .eq("account_id", ctx.accountId);
    if (error) throw new Error(error.message);

    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: document.id,
      eventType: "results_finalized",
      message: alreadyProcessedInQr
        ? "Зафиксировал итоги акта, уже проведённого в Quick Resto"
        : recheckSkippedReason
          ? `Подвел итоги акта (без сверки с Quick Resto: ${recheckSkippedReason})`
          : "Подвел итоги акта",
      payload: {
        documentId: document.id,
        recheckSkipped: recheckSkippedReason,
        alreadyProcessedInQr,
      },
    });

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

    revalidateInventoryResultPages(document.id);
    return {
      error: null,
      ...(alreadyProcessedInQr
        ? {
            notice:
              "Акт уже был проведён в Quick Resto — итоги зафиксированы локально, повторное проведение не потребовалось.",
          }
        : {}),
    };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось финализировать итоги") };
  }
}

export async function reopenInventoryResults(input: {
  documentId: string;
  reason: string;
}): Promise<{ error: string | null }> {
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

    const { error } = await admin
      .from("documents")
      .update({
        results_finalized_at: null,
        results_finalized_by: null,
        results_reopened_at: new Date().toISOString(),
        results_reopened_by: ctx.user.id,
        // Устойчивый сигнал «итоги правились после проведения» — только когда
        // разблокируем УЖЕ проведённый акт (F6). Для обычного reopen на этапе
        // проверки (не processed) не ставим.
        ...(isProcessed ? { results_reopened_after_processed: true } : {}),
      })
      .eq("id", document.id)
      .eq("account_id", ctx.accountId);
    if (error) throw new Error(error.message);

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

    revalidateInventoryResultPages(document.id);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось переоткрыть итоги") };
  }
}

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
 * Массовое исключение/возврат строк в управленческие итоги (из bulk-бара
 * таблицы итогов). Один round-trip + честный счётчик «N применено / M
 * пропущено» вместо клиентского цикла, который падал на первой ошибке.
 * Пропускаются строки, уже находящиеся в нужном состоянии и (при excluded)
 * участвующие в активном пересорте. Право inventory.adjust_results, общий
 * lock-гард по статусу акта.
 */
export async function bulkSetInventoryResultItemsExcluded(input: {
  documentId: string;
  itemIds: string[];
  excluded: boolean;
  reason?: string;
}): Promise<{ updated: number; skipped: number; error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.adjust_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { updated: 0, skipped: 0, error: ctx.error };

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
    if (itemIds.length === 0) return { updated: 0, skipped: 0, error: "Не выбрано ни одной строки" };

    const { data: itemsRaw } = await admin
      .from<Array<{
        id: string;
        product_name: string;
        excluded_from_totals: boolean | null;
        exclusion_rule_id: string | null;
        ingredient_id: string | null;
        external_product_id: string | null;
      }>>("document_items")
      .select("id, product_name, excluded_from_totals, exclusion_rule_id, ingredient_id, external_product_id")
      .eq("account_id", ctx.accountId)
      .eq("document_id", document.id)
      .in("id", itemIds);
    const items = itemsRaw ?? [];

    let eligible = items;
    if (input.excluded) {
      // Строку в активном пересорте нельзя исключить — сначала отменить пересорт.
      const inResort = await getActiveResortItemIds({
        admin,
        accountId: ctx.accountId,
        documentId: document.id,
        itemIds,
      });
      eligible = eligible.filter((item) => !inResort.has(item.id));
    }
    // No-op'ы (уже в нужном состоянии) пропускаем — не плодим события.
    eligible = eligible.filter((item) => Boolean(item.excluded_from_totals) !== input.excluded);
    const skipped = itemIds.length - eligible.length;
    if (eligible.length === 0) return { updated: 0, skipped, error: null };

    const reason = input.excluded ? text(input.reason) : null;
    const now = new Date().toISOString();
    const applyUpdate = async (ids: string[], dismissedAt: string | null) => {
      if (ids.length === 0) return;
      const { error } = await admin
        .from("document_items")
        .update({
          excluded_from_totals: input.excluded,
          exclude_reason: reason,
          excluded_by: input.excluded ? ctx.user.id : null,
          excluded_at: input.excluded ? now : null,
          exclusion_rule_id: null,
          exclusion_rule_dismissed_at: dismissedAt,
        })
        .eq("account_id", ctx.accountId)
        .eq("document_id", document.id)
        .in("id", ids);
      if (error) throw new Error(error.message);
    };

    if (input.excluded) {
      // Ручное исключение перекрывает происхождение: строка исключена
      // человеком, а не правилом.
      await applyUpdate(eligible.map((item) => item.id), null);
    } else {
      // Возврат в итоги: строке, на которую действует правило, ставим отметку
      // об отказе — иначе ближайший импорт применит правило заново. Смотрим не
      // только на записанное происхождение: ручное исключение его сбрасывает,
      // а правило на позицию при этом остаётся активным.
      const matchRule = await loadActiveExclusionRuleMatcher({ admin, accountId: ctx.accountId });
      const underRule = (item: (typeof eligible)[number]) =>
        Boolean(item.exclusion_rule_id) || Boolean(matchRule(item));
      await applyUpdate(eligible.filter(underRule).map((item) => item.id), now);
      await applyUpdate(
        eligible.filter((item) => !underRule(item)).map((item) => item.id),
        null,
      );
    }

    for (const item of eligible) {
      await writeInventoryResultEvent({
        supabase: ctx.supabase,
        admin,
        accountId: ctx.accountId,
        userId: ctx.user.id,
        documentId: document.id,
        documentItemId: item.id,
        eventType: input.excluded ? "exclude_enabled" : "exclude_disabled",
        message: input.excluded
          ? `Позиция «${item.product_name}» исключена из управленческих итогов`
          : `Позиция «${item.product_name}» возвращена в управленческие итоги`,
        payload: { itemId: item.id, productName: item.product_name, reason, bulk: true },
      });
    }

    revalidateInventoryResultPages(document.id);
    return { updated: eligible.length, skipped, error: null };
  } catch (error) {
    return { updated: 0, skipped: 0, error: actionErrorMessage(error, "Не удалось изменить учёт строк") };
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

    for (const item of items) {
      await writeInventoryResultEvent({
        supabase: ctx.supabase,
        admin,
        accountId: ctx.accountId,
        userId: ctx.user.id,
        documentId: document.id,
        documentItemId: item.id,
        eventType: input.needsRecount ? "recount_marked" : "recount_unmarked",
        message: input.needsRecount ? "Отметил строку на пересчёт" : "Снял пометку пересчёта",
        payload: { itemId: item.id, bulk: true },
      });
    }

    revalidateInventoryResultPages(document.id);
    return { updated: items.length, error: null };
  } catch (error) {
    return { updated: 0, error: actionErrorMessage(error, "Не удалось изменить пометки пересчёта") };
  }
}

/**
 * Массовое добавление позиций в автоисключения (bulk-бар «Исключать всегда»).
 * Серверный цикл (правило создаётся пер-строчно), один round-trip + счётчик.
 * Пропускаются строки без QR-идентификатора и участвующие в активном пересорте.
 * Право inventory.adjust_results.
 */
export async function bulkCreateInventoryResultExclusionRules(input: {
  documentId: string;
  itemIds: string[];
  reason?: string;
}): Promise<{ updated: number; skipped: number; error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.adjust_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { updated: 0, skipped: 0, error: ctx.error };

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
    if (itemIds.length === 0) return { updated: 0, skipped: 0, error: "Не выбрано ни одной строки" };

    const { data: itemsRaw } = await admin
      .from<
        Array<{
          id: string;
          product_name: string;
          ingredient_id: string | null;
          external_product_id: string | null;
        }>
      >("document_items")
      .select("id, product_name, ingredient_id, external_product_id")
      .eq("account_id", ctx.accountId)
      .eq("document_id", document.id)
      .in("id", itemIds);
    const items = itemsRaw ?? [];
    const inResort = await getActiveResortItemIds({
      admin,
      accountId: ctx.accountId,
      documentId: document.id,
      itemIds,
    });

    const reason = text(input.reason);
    const now = new Date().toISOString();
    let updated = 0;
    for (const item of items) {
      // Без QR-идентификатора правило создать нельзя; в активном пересорте — нельзя.
      if ((!item.ingredient_id && !item.external_product_id) || inResort.has(item.id)) continue;

      let ruleQuery = admin
        .from<InventoryExclusionRuleLookup>("inventory_result_exclusion_rules")
        .select("id")
        .eq("account_id", ctx.accountId)
        .eq("status", "active");
      ruleQuery = item.ingredient_id
        ? ruleQuery.eq("ingredient_id", item.ingredient_id)
        : ruleQuery.eq("external_product_id", item.external_product_id);
      const { data: existingRule } = await ruleQuery.maybeSingle();

      let ruleId = existingRule?.id ?? null;
      if (!ruleId) {
        const { data: rule, error: ruleError } = await admin
          .from<{ id: string }>("inventory_result_exclusion_rules")
          .insert({
            account_id: ctx.accountId,
            ingredient_id: item.ingredient_id,
            external_product_id: item.external_product_id,
            product_name: item.product_name,
            reason,
            created_by: ctx.user.id,
          })
          .select("id")
          .single();
        if (ruleError || !rule?.id) throw new Error(ruleError?.message ?? "Не удалось создать правило автоисключения");
        ruleId = rule.id;
      }

      const { error: itemError } = await admin
        .from("document_items")
        .update({
          excluded_from_totals: true,
          exclude_reason: reason,
          excluded_by: ctx.user.id,
          excluded_at: now,
          exclusion_rule_id: ruleId,
          exclusion_rule_dismissed_at: null,
        })
        .eq("id", item.id)
        .eq("account_id", ctx.accountId);
      if (itemError) throw new Error(itemError.message);

      await writeInventoryResultEvent({
        supabase: ctx.supabase,
        admin,
        accountId: ctx.accountId,
        userId: ctx.user.id,
        documentId: document.id,
        documentItemId: item.id,
        eventType: "persistent_exclusion_enabled",
        message: `Позиция «${item.product_name}» добавлена в автоисключения`,
        payload: { itemId: item.id, productName: item.product_name, ruleId, reason, bulk: true },
      });
      updated += 1;
    }

    revalidateInventoryResultPages(document.id);
    return { updated, skipped: itemIds.length - updated, error: null };
  } catch (error) {
    return { updated: 0, skipped: 0, error: actionErrorMessage(error, "Не удалось добавить автоисключения") };
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

export async function updateInventoryStoreVenue(input: {
  storeId: string;
  venueId: string | null;
}): Promise<{ error: string | null }> {
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

  const { error } = await admin
    .from("stores")
    .update({ local_venue_id: input.venueId || null })
    .eq("id", input.storeId)
    .eq("account_id", ctx.accountId);

  if (error) return { error: error.message };

  // Пропагация venue в documents.venue_id — на уровне БД (триггер
  // trg_stores_propagate_venue_to_documents, миграция 194), атомарно
  // в той же транзакции UPDATE stores. Второй write из app не нужен.
  revalidatePath("/org/stores");
  return { error: null };
}

export async function uploadInventoryProductImage(formData: FormData): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.manage_products");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const productId = text(formData.get("productId"));
  const file = formData.get("file");
  if (!productId) return { error: "Не указан ингредиент" };
  if (!(file instanceof File) || file.size === 0) return { error: "Выберите изображение" };
  if (!file.type.startsWith("image/")) return { error: "Можно загрузить только изображение" };

  const admin = asLooseDb(createAdminClient());
  const { data: product } = await admin
    .from<{ id: string }>("ingredients")
    .select("id")
    .eq("id", productId)
    .eq("account_id", ctx.accountId)
    .maybeSingle();
  if (!product?.id) return { error: "Ингредиент не найден" };

  const storagePath = buildStoragePath(ctx.accountId, file.name);
  const { error: uploadError } = await admin.storage
    .from("account-attachments")
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (uploadError) return { error: uploadError.message };

  const { data: fileRow, error: fileError } = await admin
    .from<{ id: string }>("account_files")
    .insert({
      account_id: ctx.accountId,
      storage_path: storagePath,
      name: file.name,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      uploaded_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (fileError || !fileRow?.id) {
    await admin.storage.from("account-attachments").remove([storagePath]);
    return { error: fileError?.message ?? "Не удалось сохранить файл" };
  }

  const { error: productError } = await admin
    .from("ingredients")
    .update({ primary_image_file_id: fileRow.id })
    .eq("id", productId)
    .eq("account_id", ctx.accountId);
  if (productError) return { error: productError.message };

  revalidatePath("/catalog/ingredients");
  revalidatePath(`/catalog/ingredients/${productId}`);
  return { error: null };
}

export async function uploadInventoryProductGroupImage(formData: FormData): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.manage_products");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const groupId = text(formData.get("groupId"));
  const file = formData.get("file");
  if (!groupId) return { error: "Не указана группа ингредиентов" };
  if (!(file instanceof File) || file.size === 0) return { error: "Выберите изображение" };
  if (!file.type.startsWith("image/")) return { error: "Можно загрузить только изображение" };

  const admin = asLooseDb(createAdminClient());
  const { data: group } = await admin
    .from<{ id: string }>("ingredient_groups")
    .select("id")
    .eq("id", groupId)
    .eq("account_id", ctx.accountId)
    .maybeSingle();
  if (!group?.id) return { error: "Группа ингредиентов не найдена" };

  const storagePath = buildStoragePath(ctx.accountId, file.name);
  const { error: uploadError } = await admin.storage
    .from("account-attachments")
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (uploadError) return { error: uploadError.message };

  const { data: fileRow, error: fileError } = await admin
    .from<{ id: string }>("account_files")
    .insert({
      account_id: ctx.accountId,
      storage_path: storagePath,
      name: file.name,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      uploaded_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (fileError || !fileRow?.id) {
    await admin.storage.from("account-attachments").remove([storagePath]);
    return { error: fileError?.message ?? "Не удалось сохранить файл" };
  }

  const { error: groupError } = await admin
    .from("ingredient_groups")
    .update({ primary_image_file_id: fileRow.id })
    .eq("id", groupId)
    .eq("account_id", ctx.accountId);
  if (groupError) return { error: groupError.message };

  revalidatePath("/catalog/ingredients");
  return { error: null };
}

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

async function writeIngredientJournal(input: {
  admin: LooseDb;
  accountId: string;
  ingredientId: string;
  eventType:
    | "synced"
    | "description_updated"
    | "photo_updated"
    | "supplier_added"
    | "supplier_updated"
    | "supplier_removed";
  payload?: Record<string, unknown>;
  actorId: string;
}) {
  await input.admin.from("ingredient_journal").insert({
    account_id: input.accountId,
    ingredient_id: input.ingredientId,
    event_type: input.eventType,
    payload: input.payload ?? {},
    actor_id: input.actorId,
  });
}

async function assertOwnedIngredient(admin: LooseDb, accountId: string, ingredientId: string) {
  const { data } = await admin
    .from<{ id: string }>("ingredients")
    .select("id")
    .eq("id", ingredientId)
    .eq("account_id", accountId)
    .maybeSingle();
  return Boolean(data?.id);
}

/**
 * Обзор ингредиента для боковой панели из «Итогов» акта: клик по названию
 * позиции открывает Sheet с основными данными карточки (без загрузки
 * полной страницы). Переиспользует getIngredientDetail.
 *
 * Гейт — `inventory.view_products`: та же граница, что у каталога
 * (страница карточки ингредиента проверяет именно это право). Иначе
 * пользователь с view_results, но без view_products, получил бы метаданные
 * каталога (артикул, штрих-код, себестоимость, остаток) в обход (Codex P1 #404).
 */
export async function getInventoryIngredientOverview(input: {
  ingredientId: string;
}): Promise<{ data: IngredientDetail | null; error: string | null }> {
  const ctx = await getActiveContext("inventory.view_products");
  if (ctx.error || !ctx.accountId) return { data: null, error: ctx.error };
  try {
    const data = await getIngredientDetail(ctx.accountId, input.ingredientId);
    return { data: data ?? null, error: null };
  } catch (error) {
    return { data: null, error: actionErrorMessage(error, "Не удалось загрузить ингредиент") };
  }
}

export async function updateIngredientDescription(input: {
  ingredientId: string;
  description: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.manage_products");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const ingredientId = text(input.ingredientId);
  if (!ingredientId) return { error: "Не указан ингредиент" };
  const description = typeof input.description === "string" ? input.description.trim() : "";

  const admin = asLooseDb(createAdminClient());
  if (!(await assertOwnedIngredient(admin, ctx.accountId, ingredientId))) {
    return { error: "Ингредиент не найден" };
  }

  const { error } = await admin
    .from("ingredients")
    .update({ local_description: description || null })
    .eq("id", ingredientId)
    .eq("account_id", ctx.accountId);
  if (error) return { error: error.message };

  await writeIngredientJournal({
    admin,
    accountId: ctx.accountId,
    ingredientId,
    eventType: "description_updated",
    payload: { hasText: description.length > 0 },
    actorId: ctx.user.id,
  });

  revalidatePath(`/catalog/ingredients/${ingredientId}`);
  return { error: null };
}

async function assertOwnedCounterparty(admin: LooseDb, accountId: string, counterpartyId: string) {
  const { data } = await admin
    .from<{ id: string }>("counterparties")
    .select("id")
    .eq("id", counterpartyId)
    .eq("account_id", accountId)
    .maybeSingle();
  return Boolean(data?.id);
}

export async function addIngredientSupplier(input: {
  ingredientId: string;
  counterpartyId: string;
  supplierArticle?: string | null;
  supplierPrice?: number | string | null;
  isPreferred?: boolean;
  note?: string | null;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.manage_products");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const ingredientId = text(input.ingredientId);
  const counterpartyId = text(input.counterpartyId);
  if (!ingredientId) return { error: "Не указан ингредиент" };
  if (!counterpartyId) return { error: "Выберите контрагента-поставщика" };

  const admin = asLooseDb(createAdminClient());
  if (!(await assertOwnedIngredient(admin, ctx.accountId, ingredientId))) {
    return { error: "Ингредиент не найден" };
  }
  if (!(await assertOwnedCounterparty(admin, ctx.accountId, counterpartyId))) {
    return { error: "Контрагент не найден" };
  }

  const { error } = await admin.from("ingredient_suppliers").insert({
    account_id: ctx.accountId,
    ingredient_id: ingredientId,
    counterparty_id: counterpartyId,
    supplier_article: text(input.supplierArticle),
    supplier_price: priceNum(input.supplierPrice),
    is_preferred: Boolean(input.isPreferred),
    note: text(input.note),
  });
  if (error) {
    return {
      error: /duplicate key|unique/i.test(error.message)
        ? "Этот поставщик уже добавлен к ингредиенту"
        : error.message,
    };
  }

  await writeIngredientJournal({
    admin,
    accountId: ctx.accountId,
    ingredientId,
    eventType: "supplier_added",
    payload: { counterpartyId },
    actorId: ctx.user.id,
  });

  revalidatePath(`/catalog/ingredients/${ingredientId}`);
  return { error: null };
}

export async function updateIngredientSupplier(input: {
  supplierId: string;
  supplierArticle?: string | null;
  supplierPrice?: number | string | null;
  isPreferred?: boolean;
  note?: string | null;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.manage_products");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const supplierId = text(input.supplierId);
  if (!supplierId) return { error: "Не указана связка поставщика" };

  const admin = asLooseDb(createAdminClient());
  const { data: existing } = await admin
    .from<{ id: string; ingredient_id: string }>("ingredient_suppliers")
    .select("id, ingredient_id")
    .eq("id", supplierId)
    .eq("account_id", ctx.accountId)
    .maybeSingle();
  if (!existing?.id) return { error: "Связка поставщика не найдена" };

  const { error } = await admin
    .from("ingredient_suppliers")
    .update({
      supplier_article: text(input.supplierArticle),
      supplier_price: priceNum(input.supplierPrice),
      is_preferred: Boolean(input.isPreferred),
      note: text(input.note),
    })
    .eq("id", supplierId)
    .eq("account_id", ctx.accountId);
  if (error) return { error: error.message };

  await writeIngredientJournal({
    admin,
    accountId: ctx.accountId,
    ingredientId: existing.ingredient_id,
    eventType: "supplier_updated",
    payload: { supplierId },
    actorId: ctx.user.id,
  });

  revalidatePath(`/catalog/ingredients/${existing.ingredient_id}`);
  return { error: null };
}

export async function removeIngredientSupplier(input: {
  supplierId: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.manage_products");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const supplierId = text(input.supplierId);
  if (!supplierId) return { error: "Не указана связка поставщика" };

  const admin = asLooseDb(createAdminClient());
  const { data: existing } = await admin
    .from<{ id: string; ingredient_id: string; counterparty_id: string }>("ingredient_suppliers")
    .select("id, ingredient_id, counterparty_id")
    .eq("id", supplierId)
    .eq("account_id", ctx.accountId)
    .maybeSingle();
  if (!existing?.id) return { error: "Связка поставщика не найдена" };

  const { error } = await admin
    .from("ingredient_suppliers")
    .delete()
    .eq("id", supplierId)
    .eq("account_id", ctx.accountId);
  if (error) return { error: error.message };

  await writeIngredientJournal({
    admin,
    accountId: ctx.accountId,
    ingredientId: existing.ingredient_id,
    eventType: "supplier_removed",
    payload: { counterpartyId: existing.counterparty_id },
    actorId: ctx.user.id,
  });

  revalidatePath(`/catalog/ingredients/${existing.ingredient_id}`);
  return { error: null };
}
