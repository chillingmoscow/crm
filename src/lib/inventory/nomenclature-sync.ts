import "server-only";

// Сверка номенклатуры Quick Resto с каталогом: ингредиенты, блюда,
// полуфабрикаты, модификаторы и их группы. Без складов и актов.
//
// Работает без пользовательской сессии: аккаунт и admin-клиент передаются
// явно. Вызывают кнопка «Синхронизировать» (полный синк, перед складами и
// актами) и фоновый обработчик /api/cron/sales-shifts раз в несколько часов —
// чтобы правила допродаж видели новые блюда и модификаторы без ручной кнопки.

import { writeAuditEvent } from "@/lib/audit/write";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import {
  listDishTreeItems,
  listIngredientTreeItems,
  listModifierTreeItems,
  listSemiProductTreeItems,
  type QuickRestoSingleCategory,
  type QuickRestoSingleProduct,
} from "@/lib/integrations/quickresto/client";
import {
  catalogChunks,
  catalogKey,
  connectionPassword,
  getConnection,
  groupName,
  isQuickRestoClass,
  num,
  productName,
  quickRestoParentExternalId,
  saveSnapshots,
  text,
  upsertExternalLinks,
  type InventoryProductLookup,
  type QuickRestoConnection,
} from "@/app/(dashboard)/inventory/actions-shared";
import { planArchive, splitByChange } from "@/lib/inventory/nomenclature-diff";

/** Как часто фоновый обработчик сверяет номенклатуру одного аккаунта. */
export const NOMENCLATURE_SYNC_INTERVAL_MS = 3 * 60 * 60 * 1000;

/**
 * Виды номенклатуры. Названия классов подтверждены пробой на живом
 * подключении — плоский list по модулям блюд и полуфабрикатов отдаёт корневые
 * категории (DishCategory / SemiCategory), а товары лежат ниже и достаются
 * фильтром parentId neq 0.
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
    title: "ингредиенты",
  },
  {
    kind: "dish",
    categorySuffix: "DishCategory",
    productSuffix: "Dish",
    entityType: "dish",
    groupEntityType: "dish_group",
    productNoun: "Блюдо",
    groupNoun: "категорий блюд",
    title: "блюда",
  },
  {
    kind: "semi_finished",
    categorySuffix: "SemiCategory",
    productSuffix: "SemiProduct",
    entityType: "semi_finished",
    groupEntityType: "semi_finished_group",
    productNoun: "Полуфабрикат",
    groupNoun: "категорий полуфабрикатов",
    title: "полуфабрикаты",
  },
  {
    kind: "modifier",
    categorySuffix: "ModifierGroup",
    productSuffix: "Modifier",
    entityType: "modifier",
    groupEntityType: "modifier_group",
    productNoun: "Модификатор",
    groupNoun: "групп модификаторов",
    title: "модификаторы",
  },
] as const;

type NomenclatureImportSpec = (typeof NOMENCLATURE_IMPORTS)[number];
export type NomenclatureKind = NomenclatureImportSpec["kind"];

/** Поля группы, изменение которых означает «группа изменилась». */
const GROUP_COMPARE_KEYS = ["name", "item_title", "parent_external_id", "raw_payload"] as const;

/** Поля позиции, изменение которых означает «позиция изменилась». */
const PRODUCT_COMPARE_KEYS = [
  "external_version",
  "name",
  "item_title",
  "article",
  "barcode",
  "measure_unit_id",
  "measure_unit_name",
  "measure_unit_full_name",
  "measure_unit_code",
  "ratio",
  "group_id",
  "parent_external_id",
  "tags",
  "current_prime_cost",
  "store_quantity_kg",
  "stock_limit",
  "raw_payload",
] as const;

export type NomenclatureKindCounts = {
  groups: number;
  products: number;
  added: number;
  updated: number;
  archived: number;
  restored: number;
};

export type NomenclatureSyncOutcome = {
  totals: NomenclatureKindCounts;
  byKind: Partial<Record<NomenclatureKind, NomenclatureKindCounts>>;
  /** Что сверка пропустила, не прерывая прохода. Текст для пользователя. */
  warnings: string[];
  /** Все позиции каталога по ключу «вид + внешний id» — для привязки строк актов. */
  productByExternalId: Map<string, InventoryProductLookup>;
};

/** Итоги последнего запуска — хранятся в integration_connections.nomenclature_sync_result. */
export type NomenclatureSyncResult = {
  ok: boolean;
  error: string | null;
  trigger: "schedule" | "manual";
  finishedAt: string;
  added: number;
  updated: number;
  archived: number;
  restored: number;
  warnings: string[];
};

const emptyCounts = (): NomenclatureKindCounts => ({
  groups: 0,
  products: 0,
  added: 0,
  updated: 0,
  archived: 0,
  restored: 0,
});

// Дедуп по external_id обязателен: PostgreSQL не даёт одному INSERT ... ON
// CONFLICT DO UPDATE задеть одну строку дважды. Оставляем последнюю версию.
const dedupeByExternalId = <T extends { external_id: string }>(rows: T[]): T[] =>
  Array.from(new Map(rows.map((row) => [row.external_id, row])).values());

/**
 * Импорт одного вида номенклатуры: категории, товары, связи, снимки и
 * архивация пропавших. Пишется только новое и изменённое.
 */
async function importNomenclatureKind(input: {
  admin: LooseDb;
  accountId: string;
  syncedAt: string;
  spec: NomenclatureImportSpec;
  items: unknown[];
  productByExternalId: Map<string, InventoryProductLookup>;
  warnings: string[];
}): Promise<NomenclatureKindCounts> {
  const { admin, accountId, syncedAt, spec, items, productByExternalId, warnings } = input;
  const counts = emptyCounts();

  const groups = items.filter((item) => isQuickRestoClass(item, spec.categorySuffix)) as QuickRestoSingleCategory[];
  const products = items.filter((item) => isQuickRestoClass(item, spec.productSuffix)) as QuickRestoSingleProduct[];

  // ── Категории ─────────────────────────────────────────────────────────────
  type ExistingGroup = {
    id: string;
    external_id: string;
    name: string;
    item_title: string | null;
    parent_external_id: string | null;
    parent_group_id: string | null;
    raw_payload: unknown;
  };
  const existingGroups = await fetchAllRows<ExistingGroup>(() =>
    admin
      .from<ExistingGroup[]>("ingredient_groups")
      .select("id, external_id, name, item_title, parent_external_id, parent_group_id, raw_payload")
      .eq("account_id", accountId)
      .eq("kind", spec.kind),
  );
  const existingGroupByExternalId = new Map(existingGroups.map((row) => [row.external_id, row]));

  const groupRows = dedupeByExternalId(
    groups
      .filter((group) => typeof group.id === "number")
      .map((group) => ({
        account_id: accountId,
        external_id: String(group.id),
        kind: spec.kind,
        name: groupName(group),
        item_title: text(group.itemTitle),
        parent_external_id: quickRestoParentExternalId(group),
        raw_payload: group as unknown,
        synced_at: syncedAt,
      })),
  );
  counts.groups = groupRows.length;

  const groupByExternalId = new Map<string, string>(existingGroups.map((row) => [row.external_id, row.id]));
  const groupSplit = splitByChange(
    groupRows,
    existingGroupByExternalId as Map<string, Record<string, unknown>>,
    GROUP_COMPARE_KEYS,
  );
  const groupWrites = [...groupSplit.inserted, ...groupSplit.changed];
  for (const chunk of catalogChunks(groupWrites)) {
    const { data, error } = await admin
      .from<Array<{ id: string; external_id: string }>>("ingredient_groups")
      .upsert(chunk, { onConflict: "account_id,kind,external_id" })
      .select("id, external_id");
    if (error) throw new Error(error.message);
    for (const row of data ?? []) groupByExternalId.set(row.external_id, row.id);
  }
  if (groupRows.some((row) => !groupByExternalId.has(row.external_id))) {
    throw new Error(`Не удалось сохранить часть ${spec.groupNoun} Quick Resto`);
  }
  if (groupSplit.inserted.length > 0) {
    await upsertExternalLinks({
      admin,
      accountId,
      entityType: spec.groupEntityType,
      localTable: "ingredient_groups",
      rows: groupSplit.inserted.map((row) => ({
        externalId: row.external_id,
        localId: groupByExternalId.get(row.external_id) as string,
      })),
    });
  }
  await saveSnapshots({
    admin,
    accountId,
    entityType: spec.groupEntityType,
    rows: groupWrites.map((row) => ({ externalId: row.external_id, payload: row.raw_payload })),
  });

  // Второй проход: родители, когда локальные id уже известны. Пишем только
  // группы, у которых родитель правда сменился.
  const groupIdsByParent = new Map<string | null, string[]>();
  for (const row of groupRows) {
    const localId = groupByExternalId.get(row.external_id);
    if (!localId) continue;
    const parentId = row.parent_external_id ? groupByExternalId.get(row.parent_external_id) ?? null : null;
    const existing = existingGroupByExternalId.get(row.external_id);
    if (existing && (existing.parent_group_id ?? null) === parentId) continue;
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
  type ExistingProduct = Record<string, unknown> & {
    id: string;
    external_id: string;
    kind: string;
    article: string | null;
    barcode: string | null;
    measure_unit_name: string | null;
    archived_at: string | null;
  };
  const existingProducts = await fetchAllRows<ExistingProduct>(() =>
    admin
      .from<ExistingProduct[]>("ingredients")
      .select(["id", "kind", "archived_at", ...PRODUCT_COMPARE_KEYS, "external_id"].join(", "))
      .eq("account_id", accountId)
      .eq("kind", spec.kind),
  );
  const existingProductByExternalId = new Map(existingProducts.map((row) => [row.external_id, row]));

  const productRows = dedupeByExternalId(
    products
      .filter((product) => typeof product.id === "number")
      .map((product) => {
        const externalId = String(product.id);
        const parentExternalId = quickRestoParentExternalId(product);
        return {
          account_id: accountId,
          external_id: externalId,
          kind: spec.kind,
          external_version: typeof product.version === "number" ? product.version : null,
          name: productName(product, `${spec.productNoun} #${product.id}`),
          item_title: text(product.itemTitle),
          article: text(product.article),
          barcode: text(product.barCode),
          measure_unit_id: typeof product.measureUnit?.id === "number" ? product.measureUnit.id : null,
          // Каталог Quick Resto отдаёт единицу заглушкой без названия; имя
          // проставляет полный синк по строкам актов. Пустое имя из выгрузки
          // его не стирает — иначе сверка по расписанию обнуляла бы единицы.
          measure_unit_name:
            text(product.measureUnit?.name) ?? existingProductByExternalId.get(externalId)?.measure_unit_name ?? null,
          measure_unit_full_name: text(product.measureUnit?.fullName),
          measure_unit_code: text(product.measureUnit?.code),
          ratio: num(product.ratio),
          group_id: parentExternalId ? groupByExternalId.get(parentExternalId) ?? null : null,
          parent_external_id: parentExternalId,
          tags: Array.isArray(product.storeItemTags) ? product.storeItemTags : [],
          current_prime_cost: num(product.currentPrimeCost),
          store_quantity_kg: num(product.storeQuantityKg),
          stock_limit: num(product.limit),
          raw_payload: product as unknown,
          synced_at: syncedAt,
        };
      }),
  );
  counts.products = productRows.length;

  const productSplit = splitByChange(
    productRows,
    existingProductByExternalId as Map<string, Record<string, unknown>>,
    PRODUCT_COMPARE_KEYS,
  );
  counts.added = productSplit.inserted.length;
  counts.updated = productSplit.changed.length;

  const localByExternalId = new Map<string, InventoryProductLookup>(
    existingProducts.map((row) => [
      row.external_id,
      { id: row.id, external_id: row.external_id, article: row.article, barcode: row.barcode, kind: row.kind },
    ]),
  );
  const productWrites = [...productSplit.inserted, ...productSplit.changed];
  for (const chunk of catalogChunks(productWrites)) {
    const { data, error } = await admin
      .from<InventoryProductLookup[]>("ingredients")
      .upsert(chunk, { onConflict: "account_id,kind,external_id" })
      .select("id, external_id, article, barcode, kind");
    if (error) throw new Error(error.message);
    for (const row of data ?? []) localByExternalId.set(String(row.external_id), row);
  }
  if (productRows.some((row) => !localByExternalId.has(row.external_id))) {
    throw new Error(`Не удалось сохранить часть позиций Quick Resto (${spec.kind})`);
  }
  // Ключ карты — пара «вид + id»: идентификаторы уникальны только внутри
  // класса, и общий словарь по голому id перемешал бы виды.
  for (const [externalId, row] of localByExternalId) {
    productByExternalId.set(catalogKey(spec.kind, externalId), row);
  }
  if (productSplit.inserted.length > 0) {
    await upsertExternalLinks({
      admin,
      accountId,
      entityType: spec.entityType,
      localTable: "ingredients",
      rows: productSplit.inserted.map((row) => ({
        externalId: row.external_id,
        localId: (localByExternalId.get(row.external_id) as InventoryProductLookup).id,
      })),
    });
  }
  await saveSnapshots({
    admin,
    accountId,
    entityType: spec.entityType,
    rows: productWrites.map((row) => ({ externalId: row.external_id, payload: row.raw_payload })),
  });

  // ── Архивация пропавших ───────────────────────────────────────────────────
  //
  // Не удаляем: сохраняем историю в актах, локальные поля, поставщиков,
  // журнал. Вернувшиеся в выгрузку — разархивируем. Строго внутри своего вида,
  // иначе синк ингредиентов заархивировал бы все блюда.
  const plan = planArchive({
    incomingExternalIds: new Set(productRows.map((row) => row.external_id)),
    local: existingProducts,
  });
  if (plan.guarded) {
    warnings.push(
      productRows.length === 0
        ? `Quick Resto вернул пустой список: ${spec.title}. Архивация пропущена, в каталоге остались прежние позиции`
        : `Quick Resto не вернул ${plan.guardedCount} из живых позиций (${spec.title}) — больше половины. Похоже на сбой выгрузки, архивация пропущена`,
    );
  }
  // Списки id уходят в URL запроса — порциями.
  for (const ids of catalogChunks(plan.toArchive)) {
    const { error } = await admin.from("ingredients").update({ archived_at: syncedAt }).in("id", ids);
    if (error) throw new Error(error.message);
  }
  for (const ids of catalogChunks(plan.toUnarchive)) {
    const { error } = await admin.from("ingredients").update({ archived_at: null }).in("id", ids);
    if (error) throw new Error(error.message);
  }
  counts.archived = plan.toArchive.length;
  counts.restored = plan.toUnarchive.length;

  return counts;
}

/** Загружает номенклатуру из Quick Resto и сверяет с каталогом. */
export async function importQuickRestoNomenclature(input: {
  admin: LooseDb;
  accountId: string;
  connection: QuickRestoConnection;
  syncedAt: string;
}): Promise<NomenclatureSyncOutcome> {
  const { admin, accountId, connection, syncedAt } = input;
  const password = connectionPassword(connection);
  const auth = { layerName: connection.login, login: connection.login, password };

  const [ingredientItems, dishItems, semiItems, modifierItems] = await Promise.all([
    listIngredientTreeItems(auth),
    listDishTreeItems(auth),
    listSemiProductTreeItems(auth),
    // Модификаторы нужны только допродажам, а не складу. Их сбой (нет прав
    // в Quick Resto, другое имя модуля) не должен останавливать остальное.
    // При сбое вид пропускается целиком: пустой список заархивировал бы уже
    // загруженные (теперь от этого страхует и planArchive, но и писать нечего).
    listModifierTreeItems(auth).catch((error: unknown) => {
      console.error("[nomenclature-sync] modifiers fetch failed:", error);
      return null;
    }),
  ]);

  const warnings: string[] = [];
  if (modifierItems === null) {
    warnings.push("Модификаторы Quick Resto не загрузились — в каталоге остались прежние");
  }

  const itemsByKind: Record<NomenclatureKind, unknown[] | null> = {
    ingredient: ingredientItems,
    dish: dishItems,
    semi_finished: semiItems,
    modifier: modifierItems,
  };
  const productByExternalId = new Map<string, InventoryProductLookup>();
  const totals = emptyCounts();
  const byKind: NomenclatureSyncOutcome["byKind"] = {};
  for (const spec of NOMENCLATURE_IMPORTS) {
    const items = itemsByKind[spec.kind];
    if (items === null) continue;
    const counts = await importNomenclatureKind({
      admin,
      accountId,
      syncedAt,
      spec,
      items,
      productByExternalId,
      warnings,
    });
    byKind[spec.kind] = counts;
    for (const key of Object.keys(totals) as Array<keyof NomenclatureKindCounts>) totals[key] += counts[key];
  }
  return { totals, byKind, warnings, productByExternalId };
}

/**
 * Сверка с записью состояния и журнала: импорт, итоги последнего запуска в
 * подключении, одна строка `inventory.nomenclature.synced`, если в каталоге
 * что-то появилось, ушло в архив или вернулось. Ошибку тоже записывает в
 * состояние, а затем пробрасывает.
 */
export async function syncQuickRestoNomenclature(input: {
  admin: LooseDb;
  accountId: string;
  connection: QuickRestoConnection;
  trigger: NomenclatureSyncResult["trigger"];
  userId: string | null;
  syncedAt?: string;
}): Promise<NomenclatureSyncOutcome> {
  const { admin, accountId, connection, trigger, userId } = input;
  const syncedAt = input.syncedAt ?? new Date().toISOString();

  // Ручной запуск тоже сдвигает метку начала — чтобы обработчик по
  // расписанию не повторил его сразу следом.
  if (trigger === "manual") {
    await admin
      .from("integration_connections")
      .update({ nomenclature_sync_started_at: syncedAt })
      .eq("id", connection.id);
  }

  let outcome: NomenclatureSyncOutcome;
  try {
    outcome = await importQuickRestoNomenclature({ admin, accountId, connection, syncedAt });
  } catch (error) {
    await saveSyncResult(admin, connection.id, {
      ok: false,
      error: error instanceof Error ? error.message : "Не удалось сверить номенклатуру",
      trigger,
      finishedAt: new Date().toISOString(),
      added: 0,
      updated: 0,
      archived: 0,
      restored: 0,
      warnings: [],
    });
    throw error;
  }

  const finishedAt = new Date().toISOString();
  const { totals, byKind, warnings } = outcome;
  await saveSyncResult(
    admin,
    connection.id,
    {
      ok: true,
      error: null,
      trigger,
      finishedAt,
      added: totals.added,
      updated: totals.updated,
      archived: totals.archived,
      restored: totals.restored,
      warnings,
    },
    finishedAt,
  );

  if (totals.added + totals.archived + totals.restored > 0) {
    await writeAuditEvent({
      accountId,
      userId,
      actionCode: "inventory.nomenclature.synced",
      entityType: "integration_connection",
      entityId: connection.id,
      details: {
        trigger,
        added: totals.added,
        archived: totals.archived,
        restored: totals.restored,
        updated: totals.updated,
        by_kind: Object.fromEntries(
          Object.entries(byKind).map(([kind, counts]) => [
            kind,
            { added: counts.added, archived: counts.archived, restored: counts.restored },
          ]),
        ),
        warnings,
      },
    });
  }
  return outcome;
}

async function saveSyncResult(
  admin: LooseDb,
  connectionId: string,
  result: NomenclatureSyncResult,
  syncedAt?: string,
) {
  const { error } = await admin
    .from("integration_connections")
    .update({
      nomenclature_sync_result: result,
      ...(syncedAt ? { nomenclature_synced_at: syncedAt } : {}),
    })
    .eq("id", connectionId);
  if (error) console.error("[nomenclature-sync] не удалось сохранить итоги сверки:", error.message);
}

/**
 * Один шаг фонового обработчика: берёт подключение, которое не сверялось
 * дольше интервала, и сверяет его номенклатуру.
 *
 * Захват — условным update по метке начала: если два тика выбрали одно
 * подключение, строку получит только первый (второй увидит свежую метку и
 * обновит 0 строк). Неудачный запуск повторяется через тот же интервал, а не
 * на каждом тике: ошибка видна на странице номенклатуры.
 */
export async function processDueNomenclatureSync(now = new Date()): Promise<{
  idle: boolean;
  accountId?: string;
  error?: string;
}> {
  const admin = asLooseDb(createAdminClient());
  const cutoff = new Date(now.getTime() - NOMENCLATURE_SYNC_INTERVAL_MS).toISOString();
  const dueFilter = `nomenclature_sync_started_at.is.null,nomenclature_sync_started_at.lt."${cutoff}"`;

  const { data: candidates, error: candidatesError } = await admin
    .from<Array<{ id: string; account_id: string }>>("integration_connections")
    .select("id, account_id")
    .eq("provider", "quickresto")
    .eq("status", "active")
    .or(dueFilter)
    .order("nomenclature_sync_started_at", { ascending: true, nullsFirst: true })
    .limit(1);
  if (candidatesError) throw new Error(candidatesError.message);
  const candidate = candidates?.[0];
  if (!candidate) return { idle: true };

  const startedAt = now.toISOString();
  const { data: claimed, error: claimError } = await admin
    .from<Array<{ id: string }>>("integration_connections")
    .update({ nomenclature_sync_started_at: startedAt })
    .eq("id", candidate.id)
    .eq("status", "active")
    .or(dueFilter)
    .select("id");
  if (claimError) throw new Error(claimError.message);
  if (!claimed || claimed.length === 0) return { idle: true };

  try {
    const connection = await getConnection(candidate.account_id);
    if (!connection) return { idle: false, accountId: candidate.account_id, error: "Подключение Quick Resto не найдено" };
    await syncQuickRestoNomenclature({
      admin,
      accountId: candidate.account_id,
      connection,
      trigger: "schedule",
      userId: null,
      syncedAt: startedAt,
    });
    return { idle: false, accountId: candidate.account_id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сверить номенклатуру";
    console.error(`[nomenclature-sync] аккаунт ${candidate.account_id}:`, message);
    return { idle: false, accountId: candidate.account_id, error: message };
  }
}

export type NomenclatureSyncState = {
  syncedAt: string | null;
  result: NomenclatureSyncResult | null;
};

/**
 * Состояние последней сверки для страниц каталога. Подключение читается
 * admin-клиентом: его RLS открыта только тем, кто управляет интеграциями, а
 * время сверки нужно всем, кто видит номенклатуру. Отдаём только эти поля.
 *
 * До первой сверки (или до миграции 381) — время последней записи каталога.
 */
export async function getNomenclatureSyncState(accountId: string): Promise<NomenclatureSyncState> {
  const admin = asLooseDb(createAdminClient());
  const { data, error } = await admin
    .from<{ nomenclature_synced_at: string | null; nomenclature_sync_result: NomenclatureSyncResult | null }>(
      "integration_connections",
    )
    .select("nomenclature_synced_at, nomenclature_sync_result")
    .eq("account_id", accountId)
    .eq("provider", "quickresto")
    .eq("status", "active")
    .maybeSingle();
  if (!error && data?.nomenclature_synced_at) {
    return { syncedAt: data.nomenclature_synced_at, result: data.nomenclature_sync_result ?? null };
  }
  const { data: lastRow } = await admin
    .from<Array<{ synced_at: string | null }>>("ingredients")
    .select("synced_at")
    .eq("account_id", accountId)
    .order("synced_at", { ascending: false })
    .range(0, 0);
  return {
    syncedAt: lastRow?.[0]?.synced_at ?? null,
    result: error ? null : data?.nomenclature_sync_result ?? null,
  };
}
