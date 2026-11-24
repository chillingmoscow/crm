"use server";

// Импорт справочников и актов из Quick Resto.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { resolveQrUnprocessedAt, resolveStatusAfterSync } from "@/lib/inventory/act-status";
import { storeVenueBindingPatch } from "@/lib/inventory/store-venue-binding";
import { storeDepartmentBindingPatch } from "@/lib/inventory/store-department-binding";
import { syncQuickRestoNomenclature } from "@/lib/inventory/nomenclature-sync";
import {
  listInventoryDocuments,
  listStores,
  readInventoryDocument,
  type QuickRestoInventoryDocument2,
  type QuickRestoInventoryItem2,
} from "@/lib/integrations/quickresto/client";
import {
  type InventoryProductLookup,
  listStockProductLookups,
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
  inventoryDocumentItems,
  inventoryDocumentNumber,
  isDeletedQuickRestoRow,
  isRecentOpenInventoryDocument,
  listBackOfficeInventoryItemsWithSession,
  quickRestoDocumentSums,
  resolveDefaultVenueId,
  saveSnapshot,
  storeTitle,
  syncDocumentItems,
  text,
  upsertExternalLink,
  writeInventoryResultEvent
} from "../actions-shared";


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
    warnings: [],
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

    // Номенклатура — общей сверкой (та же идёт по расписанию в фоновом
    // обработчике): пишет только новое и изменённое, защищена от массовой
    // архивации, сохраняет итоги запуска и строку журнала. Склады и акты
    // загружаются параллельно с ней.
    // allSettled, а не all: при сбое списка складов сверка не должна
    // продолжать писать в базу в фоне, когда экшен уже вернул ошибку.
    const settled = await Promise.allSettled([
      syncQuickRestoNomenclature({
        admin,
        accountId: ctx.accountId,
        connection,
        trigger: "manual",
        userId: ctx.user.id,
        syncedAt,
      }),
      listStores(auth),
      listInventoryDocuments(auth),
    ] as const);
    const failed = settled.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    const [nomenclature, stores, loadedDocuments] = settled.map(
      (result) => (result as PromiseFulfilledResult<unknown>).value,
    ) as [
      Awaited<ReturnType<typeof syncQuickRestoNomenclature>>,
      Awaited<ReturnType<typeof listStores>>,
      Awaited<ReturnType<typeof listInventoryDocuments>>,
    ];
    documentList = loadedDocuments;
    summary.groups = nomenclature.totals.groups;
    summary.products = nomenclature.totals.products;
    summary.warnings.push(...nomenclature.warnings);
    for (const [key, row] of nomenclature.productByExternalId) productByExternalId.set(key, row);

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
            // Подразделение — по тому же правилу: только новому складу.
            ...storeDepartmentBindingPatch({ storeExists: Boolean(existingStore?.id) }),
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
    const [productRows, { data: storeRows }, loadedDocuments] = await Promise.all([
      listStockProductLookups(admin, ctx.accountId),
      admin
        .from<InventoryStoreLookup[]>("stores")
        .select("id, external_id")
        .eq("account_id", ctx.accountId),
      listInventoryDocuments(auth),
    ]);

    documentList = loadedDocuments;
    for (const product of productRows) {
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
      // Bearer-токен sheerly-bot'а: /platform/data/warehouse.inventory.
      // items/select?ownerContextId=... возвращает items с полным набором
      // полей. Если backoffice недоступен (нет токена / нет creds) —
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
            // Статус существующего акта пишем, только когда Quick Resto его
            // провёл. Иначе upsert вернул бы статус, прочитанный ДО сетевых
            // запросов к backoffice (секунды): исполнитель за это время сдаёт
            // акт → синхронизация откатывала его в in_progress, а менеджер,
            // назначивший исполнителя, получал обратно synced. Для
            // непроведённого акта resolveStatusAfterSync и так сохраняет
            // текущий статус — значит, его просто не трогаем.
            ...(!existing || nextStatus === "processed" ? { status: nextStatus } : {}),
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
