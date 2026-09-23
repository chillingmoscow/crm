"use server";

// Импорт справочников и актов из Quick Resto.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { resolveQrUnprocessedAt, resolveStatusAfterSync } from "@/lib/inventory/act-status";
import { storeVenueBindingPatch } from "@/lib/inventory/store-venue-binding";
import {
  listDishTreeItems,
  listIngredientTreeItems,
  listInventoryDocuments,
  listSemiProductTreeItems,
  QUICK_RESTO_CATEGORY_CLASSES,
  listStores,
  readInventoryDocument,
  type QuickRestoInventoryDocument2,
  type QuickRestoInventoryItem2,
  type QuickRestoSingleCategory,
  type QuickRestoSingleProduct
} from "@/lib/integrations/quickresto/client";
import {
  type InventoryProductLookup,
  type InventoryStoreLookup,
  type InventorySyncSummary,
  actionErrorMessage,
  catalogChunks,
  catalogKey,
  nomenclatureKind,
  connectionPassword,
  dateText,
  extractLineResult,
  getActiveContext,
  getConnection,
  groupName,
  inventoryDocumentItems,
  inventoryDocumentNumber,
  isDeletedQuickRestoRow,
  isQuickRestoClass,
  isRecentOpenInventoryDocument,
  listBackOfficeInventoryItemsWithSession,
  num,
  productName,
  quickRestoDocumentSums,
  quickRestoParentExternalId,
  resolveDefaultVenueId,
  saveSnapshot,
  saveSnapshots,
  storeTitle,
  syncDocumentItems,
  text,
  upsertExternalLink,
  upsertExternalLinks,
  writeInventoryResultEvent
} from "../actions-shared";


/**
 * Виды номенклатуры, которые тянет полный синк.
 *
 * Порядок важен только для отчётности: считается всё в одну сводку. Названия
 * классов подтверждены пробой на живом подключении — плоский list по модулям
 * блюд и полуфабрикатов отдаёт корневые категории (DishCategory / SemiCategory),
 * а товары лежат ниже и достаются фильтром parentId neq 0.
 */
const NOMENCLATURE_IMPORTS = [
  {
    kind: "ingredient",
    categorySuffix: "SingleCategory",
    productSuffix: "SingleProduct",
    entityType: "ingredient",
    groupEntityType: "ingredient_group",
    productNoun: "Ингредиент",
    groupNoun: "групп ингредиентов",
  },
  {
    kind: "dish",
    categorySuffix: "DishCategory",
    productSuffix: "Dish",
    entityType: "dish",
    groupEntityType: "dish_group",
    productNoun: "Блюдо",
    groupNoun: "категорий блюд",
  },
  {
    kind: "semi_finished",
    categorySuffix: "SemiCategory",
    productSuffix: "SemiProduct",
    entityType: "semi_finished",
    groupEntityType: "semi_finished_group",
    productNoun: "Полуфабрикат",
    groupNoun: "категорий полуфабрикатов",
  },
] as const;

type NomenclatureImportSpec = (typeof NOMENCLATURE_IMPORTS)[number];

/**
 * Импорт одного вида номенклатуры в каталог: категории, товары, связи, снимки
 * и архивация пропавших.
 *
 * Вынесено из тела синка, когда к ингредиентам добавились блюда и
 * полуфабрикаты: три копии одного и того же кода разошлись бы при первой же
 * правке. Всё, что различается между видами, собрано в NOMENCLATURE_IMPORTS.
 */
async function importNomenclatureKind(input: {
  admin: ReturnType<typeof asLooseDb>;
  accountId: string;
  syncedAt: string;
  spec: NomenclatureImportSpec;
  items: unknown[];
  productByExternalId: Map<string, InventoryProductLookup>;
}): Promise<{ groups: number; products: number }> {
  const { admin, accountId, syncedAt, spec, items, productByExternalId } = input;

  const groups = items.filter((item) => isQuickRestoClass(item, spec.categorySuffix)) as QuickRestoSingleCategory[];
  const products = items.filter((item) => isQuickRestoClass(item, spec.productSuffix)) as QuickRestoSingleProduct[];

  // Дедуп по external_id обязателен: PostgreSQL не даёт одному INSERT ... ON
  // CONFLICT DO UPDATE задеть одну строку дважды. Оставляем последнюю версию.
  const dedupeByExternalId = <T extends { external_id: string }>(rows: T[]): T[] =>
    Array.from(new Map(rows.map((row) => [row.external_id, row])).values());

  // ── Категории ─────────────────────────────────────────────────────────────
  const groupByExternalId = new Map<string, string>();
  const groupRows = dedupeByExternalId(
    groups
      .filter((group) => typeof group.id === "number")
      .map((group) => ({
        account_id: accountId,
        external_id: String(group.id),
        kind: spec.kind,
        name: groupName(group),
        item_title: text(group.itemTitle),
        parent_group_id: null,
        parent_external_id: quickRestoParentExternalId(group),
        raw_payload: group,
        synced_at: syncedAt,
      })),
  );
  for (const chunk of catalogChunks(groupRows)) {
    const { data, error } = await admin
      .from<Array<{ id: string; external_id: string }>>("ingredient_groups")
      .upsert(chunk, { onConflict: "account_id,kind,external_id" })
      .select("id, external_id");
    if (error) throw new Error(error.message);
    for (const row of data ?? []) groupByExternalId.set(row.external_id, row.id);
  }
  if (groupByExternalId.size < groupRows.length) {
    throw new Error(`Не удалось сохранить часть ${spec.groupNoun} Quick Resto`);
  }
  await upsertExternalLinks({
    admin,
    accountId,
    entityType: spec.groupEntityType,
    localTable: "ingredient_groups",
    rows: groupRows.map((row) => ({
      externalId: row.external_id,
      localId: groupByExternalId.get(row.external_id) as string,
    })),
  });
  await saveSnapshots({
    admin,
    accountId,
    entityType: spec.groupEntityType,
    rows: groupRows.map((row) => ({ externalId: row.external_id, payload: row.raw_payload })),
  });

  // Второй проход: расставляем родителей, когда локальные id уже известны.
  // Идём по groupRows, а не по исходному массиву: там уже сделан дедуп, и по
  // сырым данным один локальный id попал бы сразу в несколько бакетов.
  const groupIdsByParent = new Map<string | null, string[]>();
  for (const row of groupRows) {
    const localId = groupByExternalId.get(row.external_id);
    if (!localId) continue;
    const parentId = row.parent_external_id
      ? groupByExternalId.get(row.parent_external_id) ?? null
      : null;
    const bucket = groupIdsByParent.get(parentId) ?? [];
    bucket.push(localId);
    groupIdsByParent.set(parentId, bucket);
  }
  for (const [parentId, ids] of groupIdsByParent) {
    for (const chunk of catalogChunks(ids)) {
      const { error } = await admin
        .from("ingredient_groups")
        .update({ parent_group_id: parentId })
        .eq("account_id", accountId)
        .in("id", chunk);
      if (error) throw new Error(error.message);
    }
  }

  // ── Товары ────────────────────────────────────────────────────────────────
  const productRows = dedupeByExternalId(
    products
      .filter((product) => typeof product.id === "number")
      .map((product) => {
        const parentExternalId = quickRestoParentExternalId(product);
        return {
          account_id: accountId,
          external_id: String(product.id),
          kind: spec.kind,
          external_version: typeof product.version === "number" ? product.version : null,
          name: productName(product, `${spec.productNoun} #${product.id}`),
          item_title: text(product.itemTitle),
          article: text(product.article),
          barcode: text(product.barCode),
          measure_unit_id: typeof product.measureUnit?.id === "number" ? product.measureUnit.id : null,
          measure_unit_name: text(product.measureUnit?.name),
          measure_unit_full_name: text(product.measureUnit?.fullName),
          measure_unit_code: text(product.measureUnit?.code),
          ratio: num(product.ratio),
          group_id: parentExternalId ? groupByExternalId.get(parentExternalId) ?? null : null,
          parent_external_id: parentExternalId,
          tags: Array.isArray(product.storeItemTags) ? product.storeItemTags : [],
          current_prime_cost: num(product.currentPrimeCost),
          store_quantity_kg: num(product.storeQuantityKg),
          stock_limit: num(product.limit),
          raw_payload: product,
          synced_at: syncedAt,
        };
      }),
  );
  const localByExternalId = new Map<string, InventoryProductLookup>();
  for (const chunk of catalogChunks(productRows)) {
    const { data, error } = await admin
      .from<InventoryProductLookup[]>("ingredients")
      .upsert(chunk, { onConflict: "account_id,kind,external_id" })
      .select("id, external_id, article, barcode, kind");
    if (error) throw new Error(error.message);
    for (const row of data ?? []) localByExternalId.set(String(row.external_id), row);
  }
  if (localByExternalId.size < productRows.length) {
    throw new Error(`Не удалось сохранить часть позиций Quick Resto (${spec.kind})`);
  }
  // Ключ карты — пара «вид + id»: идентификаторы уникальны только внутри
  // класса, и общий словарь по голому id перемешал бы виды.
  for (const [externalId, row] of localByExternalId) {
    productByExternalId.set(catalogKey(spec.kind, externalId), row);
  }
  await upsertExternalLinks({
    admin,
    accountId,
    entityType: spec.entityType,
    localTable: "ingredients",
    rows: productRows.map((row) => ({
      externalId: row.external_id,
      localId: (localByExternalId.get(row.external_id) as InventoryProductLookup).id,
    })),
  });
  await saveSnapshots({
    admin,
    accountId,
    entityType: spec.entityType,
    rows: productRows.map((row) => ({ externalId: row.external_id, payload: row.raw_payload })),
  });

  // ── Архивация пропавших ───────────────────────────────────────────────────
  //
  // Не удаляем: сохраняем историю в актах, локальные поля, поставщиков,
  // журнал. Вернувшиеся в выгрузку — разархивируем. Строго внутри своего вида,
  // иначе синк ингредиентов заархивировал бы все блюда.
  {
    const incoming = new Set(productRows.map((row) => row.external_id));
    const { data: localProducts } = await admin
      .from<Array<{ id: string; external_id: string; archived_at: string | null }>>("ingredients")
      .select("id, external_id, archived_at")
      .eq("account_id", accountId)
      .eq("kind", spec.kind);
    const toArchive = (localProducts ?? [])
      .filter((row) => row.external_id && !incoming.has(row.external_id) && !row.archived_at)
      .map((row) => row.id);
    const toUnarchive = (localProducts ?? [])
      .filter((row) => row.external_id && incoming.has(row.external_id) && row.archived_at)
      .map((row) => row.id);
    if (toArchive.length > 0) {
      await admin.from("ingredients").update({ archived_at: syncedAt }).in("id", toArchive);
    }
    if (toUnarchive.length > 0) {
      await admin.from("ingredients").update({ archived_at: null }).in("id", toUnarchive);
    }
  }

  return { groups: groupRows.length, products: productRows.length };
}


/**
 * Восстанавливает связь строк актов с каталогом.
 *
 * `document_items.ingredient_id` заполняется один раз — при импорте акта, из
 * снимка каталога на тот момент. Если позиция появилась в каталоге позже, связь
 * сама не возникает: на проде так и висели строки, синкнутые 23 июня, тогда как
 * ингредиенты завелись 7 июля, — при том что более поздние акты на те же
 * позиции привязаны нормально.
 *
 * Вид берём из сохранённого payload'а строки (`productDtype`), а не из
 * каталога: искать по голому идентификатору нельзя, они уникальны только
 * внутри класса Quick Resto.
 *
 * Строки, чья позиция удалена из Quick Resto, так и останутся без связи — это
 * нормально и чинить нечем.
 */
async function relinkOrphanDocumentItems(input: {
  admin: ReturnType<typeof asLooseDb>;
  accountId: string;
  productByExternalId: Map<string, InventoryProductLookup>;
}): Promise<number> {
  const { admin, accountId, productByExternalId } = input;
  if (productByExternalId.size === 0) return 0;

  const { data: orphans } = await admin
    .from<Array<{ id: string; external_product_id: string | null; raw_payload: unknown }>>(
      "document_items",
    )
    .select("id, external_product_id, raw_payload")
    .eq("account_id", accountId)
    .is("ingredient_id", null);

  // Группируем по локальной позиции: обновлений столько, сколько различных
  // позиций, а не по одному на строку.
  const itemIdsByIngredient = new Map<string, string[]>();
  for (const row of orphans ?? []) {
    if (!row.external_product_id) continue;
    const kind = nomenclatureKind((row.raw_payload ?? {}) as QuickRestoInventoryItem2);
    const local = productByExternalId.get(catalogKey(kind, String(row.external_product_id)));
    if (!local?.id) continue;
    const bucket = itemIdsByIngredient.get(local.id) ?? [];
    bucket.push(row.id);
    itemIdsByIngredient.set(local.id, bucket);
  }

  let relinked = 0;
  for (const [ingredientId, itemIds] of itemIdsByIngredient) {
    for (const chunk of catalogChunks(itemIds)) {
      const { error } = await admin
        .from("document_items")
        .update({ ingredient_id: ingredientId })
        .eq("account_id", accountId)
        .in("id", chunk);
      if (error) throw new Error(error.message);
      relinked += chunk.length;
    }
  }
  return relinked;
}

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
    relinked: 0,
  };

  // Словарь групп теперь свой у каждого вида — он живёт внутри
  // importNomenclatureKind, чтобы категории блюд не смешивались с
  // ингредиентными.
  const productByExternalId = new Map<string, InventoryProductLookup>();
  const storeByExternalId = new Map<string, string>();
  let documentList: QuickRestoInventoryDocument2[] = [];

  if (scope === "full") {
    const defaultVenueId = await resolveDefaultVenueId({
      admin,
      accountId: ctx.accountId,
      activeVenueId: ctx.venueId,
    });

    const [ingredientItems, dishItems, semiItems, stores, loadedDocuments] = await Promise.all([
      listIngredientTreeItems(auth),
      listDishTreeItems(auth),
      listSemiProductTreeItems(auth),
      listStores(auth),
      listInventoryDocuments(auth),
    ]);
    documentList = loadedDocuments;

    // Три вида номенклатуры импортируются одинаково — отличаются источником,
    // классами категории и товара и значением kind. Раньше здесь был
    // развёрнутый импорт одних ингредиентов, а блюда и полуфабрикаты в каталог
    // не доезжали вовсе: строки актов на них оставались без ingredient_id, и
    // пересорт для них был недоступен (#531).
    for (const spec of NOMENCLATURE_IMPORTS) {
      const counts = await importNomenclatureKind({
        admin,
        accountId: ctx.accountId,
        syncedAt,
        spec,
        items: { ingredient: ingredientItems, dish: dishItems, semi_finished: semiItems }[spec.kind] as unknown[],
        productByExternalId,
      });
      summary.groups += counts.groups;
      summary.products += counts.products;
    }

    // Обратная привязка строк актов к каталогу.
    //
    // `ingredient_id` резолвится один раз, в момент импорта акта. Акт,
    // импортированный до того, как позиция появилась в каталоге, оставался без
    // связки навсегда — на проде так висели две строки, синкнутые 23 июня, при
    // том что сами ингредиенты завелись 7 июля. Импорт блюд и полуфабрикатов
    // тот же случай в большом масштабе: без этого прохода 186 существующих
    // строк остались бы пустыми, и пересорт для них не заработал бы.
    summary.relinked = await relinkOrphanDocumentItems({
      admin,
      accountId: ctx.accountId,
      productByExternalId,
    });

    for (const store of stores) {
      if (typeof store.id !== "number") continue;
      // Спрашиваем ровно одно: есть ли уже такой склад. От ответа зависит,
      // трогаем ли привязку к заведению.
      //
      // Ошибку чтения разбираем обязательно: клиент отдаёт сбой как
      // { data: null, error }, без исключения, и «не смогли прочитать» было бы
      // неотличимо от «склада нет». Тогда существующий склад приняли бы за
      // новый и переписали бы привязку — ровно тот баг, который здесь чинится,
      // только через отказ чтения.
      const { data: existingStore, error: existingStoreError } = await admin
        .from<{ id: string }>("stores")
        .select("id")
        .eq("account_id", ctx.accountId)
        .eq("external_id", String(store.id))
        .maybeSingle();
      if (existingStoreError) {
        throw new Error(`Не удалось прочитать склад ${store.id}: ${existingStoreError.message}`);
      }
      const { data, error } = await admin
        .from<{ id: string }>("stores")
        .upsert(
          {
            account_id: ctx.accountId,
            external_id: String(store.id),
            title: storeTitle(store),
            store_code: text(store.storeCode),
            description: text(store.description),
            // Привязку к заведению ставим только новому складу: у
            // существующего ключа в payload нет вовсе, и колонка не попадает
            // в DO UPDATE SET. Так переживает синхронизацию ручное
            // «Не привязан» из справочника складов.
            ...storeVenueBindingPatch({
              storeExists: Boolean(existingStore?.id),
              defaultVenueId,
            }),
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
        .select("id, external_id, article, barcode, kind")
        .eq("account_id", ctx.accountId),
      admin
        .from<InventoryStoreLookup[]>("stores")
        .select("id, external_id")
        .eq("account_id", ctx.accountId),
      listInventoryDocuments(auth),
    ]);

    documentList = loadedDocuments;
    for (const product of productRows ?? []) {
      if (!product.external_id) continue;
      // Ключ с видом — как и в полном синке: по голому id блюдо и ингредиент с
      // одинаковым номером затёрли бы друг друга.
      productByExternalId.set(
        catalogKey(product.kind ?? "ingredient", String(product.external_id)),
        product,
      );
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
    // Синк тянет все три вида номенклатуры — обновляем все три раздела.
    revalidatePath("/catalog/ingredients");
    revalidatePath("/catalog/dishes");
    revalidatePath("/catalog/semi-products");
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
  result?: unknown;
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

    const asRecord = (item: unknown): Record<string, unknown> =>
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};

    const summarize = async (
      fetcher: () => Promise<unknown[]>,
      categoryClass: string,
    ) => {
      let items: unknown[] = [];
      let error: string | null = null;
      try {
        items = await fetcher();
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }

      const byClass: Record<string, number> = {};
      for (const item of items) {
        const cls = String(asRecord(item).className ?? "unknown");
        byClass[cls] = (byClass[cls] ?? 0) + 1;
      }

      const isCategory = (item: unknown) => asRecord(item).className === categoryClass;
      const product = items.find((item) => !isCategory(item));
      const category = items.find(isCategory);

      // У товара нас интересует только то, что нужно импорту: id, имя, ссылка
      // на родителя и единица измерения. Целиком объект не тащим — у категорий
      // в нём приезжает схема столов заведения на сотню килобайт.
      const slim = (item: unknown) => {
        const obj = asRecord(item);
        const parentItem = asRecord(obj.parentItem);
        return {
          id: obj.id ?? null,
          name: obj.name ?? obj.title ?? null,
          className: obj.className ?? null,
          parentId: obj.parentId ?? parentItem.id ?? null,
          measureUnitId: asRecord(obj.measureUnit).id ?? null,
          article: obj.article ?? null,
        };
      };

      return {
        error,
        total: items.length,
        byClass,
        sampleProduct: product ? slim(product) : null,
        sampleCategory: category ? slim(category) : null,
        ids: new Set(
          items
            .filter((item) => !isCategory(item))
            .map((item) => String(asRecord(item).id ?? ""))
            .filter(Boolean),
        ),
      };
    };

    const [dish, semi] = await Promise.all([
      summarize(
        () => listDishTreeItems(auth) as Promise<unknown[]>,
        QUICK_RESTO_CATEGORY_CLASSES.dish,
      ),
      summarize(
        () => listSemiProductTreeItems(auth) as Promise<unknown[]>,
        QUICK_RESTO_CATEGORY_CLASSES.semi_finished,
      ),
    ]);

    // Главная проверка: покрывают ли найденные товары те строки актов, которые
    // сейчас висят без привязки к каталогу. Если нет — импорт их не починит, и
    // об этом лучше узнать до того, как он написан.
    const { data: orphanRows } = await admin
      .from<{ external_product_id: string | null; raw_payload: Record<string, unknown> | null }[]>(
        "document_items",
      )
      .select("external_product_id, raw_payload")
      .eq("account_id", ctx.accountId)
      .is("ingredient_id", null);

    const orphans = { Dish: new Set<string>(), SemiProduct: new Set<string>(), other: new Set<string>() };
    for (const row of orphanRows ?? []) {
      const dtype = String(asRecord(row.raw_payload).productDtype ?? "");
      const id = row.external_product_id ? String(row.external_product_id) : null;
      if (!id) continue;
      if (dtype === "Dish") orphans.Dish.add(id);
      else if (dtype === "SemiProduct") orphans.SemiProduct.add(id);
      else orphans.other.add(id);
    }

    const coverage = (want: Set<string>, have: Set<string>) => {
      const missing = Array.from(want).filter((id) => !have.has(id));
      return { нужно: want.size, найдено: want.size - missing.length, нет: missing.slice(0, 10) };
    };

    return {
      error: null,
      result: {
        блюда: { ...dish, ids: undefined, покрытие: coverage(orphans.Dish, dish.ids) },
        полуфабрикаты: { ...semi, ids: undefined, покрытие: coverage(orphans.SemiProduct, semi.ids) },
        прочие_непривязанные: Array.from(orphans.other),
      },
    };
  } catch (error) {
    return { error: actionErrorMessage(error, "Проба номенклатуры не удалась") };
  }
}

