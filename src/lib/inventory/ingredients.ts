import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  buildIngredientHistory,
  frozenDocumentIds,
  type IngredientHistoryEntry,
  type IngredientHistoryItem,
  type IngredientHistoryResort,
} from "@/lib/inventory/ingredient-history-shared";
import {
  applyResortItemSnapshot,
  applyResortSnapshot,
  type InventoryResortItemSnapshotRow,
  type InventoryResortSnapshotRow,
} from "@/lib/inventory/results-snapshot";

// Доменный слой ингредиента (Этап 1 разведения «Номенклатура»/«Документы»).
// Inventory-домен в этом проекте работает через asLooseDb (нетипизированный
// wrapper) — inventory_* таблиц нет в src/types/database.ts. Чтение здесь —
// через admin-клиент со строгим scope по account_id; проверка права
// inventory.view_products делается на уровне страницы (RSC) до вызова.

export type IngredientDetail = {
  id: string;
  externalId: string;
  name: string;
  itemTitle: string | null;
  groupId: string | null;
  groupName: string | null;
  article: string | null;
  barcode: string | null;
  measureUnitName: string | null;
  currentPrimeCost: number | null;
  storeQuantityKg: number | null;
  stockLimit: number | null;
  localDescription: string | null;
  imageFileId: string | null;
  imageUrl: string | null;
  syncedAt: string | null;
  archivedAt: string | null;
};

export type IngredientSupplier = {
  id: string;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyInn: string | null;
  counterpartyKpp: string | null;
  counterpartyPhone: string | null;
  counterpartyEmail: string | null;
  counterpartyContactPerson: string | null;
  counterpartyAddress: string | null;
  counterpartyDescription: string | null;
  supplierArticle: string | null;
  supplierPrice: number | null;
  isPreferred: boolean;
  note: string | null;
};

export type {
  IngredientHistoryEntry,
  IngredientHistoryResort,
} from "@/lib/inventory/ingredient-history-shared";

export type IngredientJournalEntry = {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  actorName: string | null;
  createdAt: string;
};

type ProductRow = {
  id: string;
  external_id: string;
  name: string;
  item_title: string | null;
  group_id: string | null;
  article: string | null;
  barcode: string | null;
  measure_unit_name: string | null;
  current_prime_cost: number | null;
  store_quantity_kg: number | null;
  stock_limit: number | null;
  local_description: string | null;
  primary_image_file_id: string | null;
  synced_at: string | null;
  archived_at: string | null;
};

async function signImageUrl(accountId: string, fileId: string | null): Promise<string | null> {
  if (!fileId) return null;
  const admin = asLooseDb(createAdminClient());
  const { data: file } = await admin
    .from<{ id: string; storage_path: string }>("account_files")
    .select("id, storage_path")
    .eq("account_id", accountId)
    .eq("id", fileId)
    .maybeSingle();
  if (!file?.storage_path) return null;
  const { data: signed } = await admin.storage
    .from("account-attachments")
    .createSignedUrl(file.storage_path, 60 * 60);
  return signed?.signedUrl ?? null;
}

export async function getIngredientDetail(
  accountId: string,
  ingredientId: string,
  kind: string = "ingredient",
): Promise<IngredientDetail | null> {
  const admin = asLooseDb(createAdminClient());
  const { data: product } = await admin
    .from<ProductRow>("ingredients")
    .select(
      "id, external_id, name, item_title, group_id, article, barcode, measure_unit_name, current_prime_cost, store_quantity_kg, stock_limit, local_description, primary_image_file_id, synced_at, archived_at",
    )
    .eq("account_id", accountId)
    .eq("id", ingredientId)
    // Карточка одного раздела не должна открываться по id позиции другого:
    // страница сделает redirect в свой список.
    .eq("kind", kind)
    .maybeSingle();
  if (!product?.id) return null;

  let groupName: string | null = null;
  if (product.group_id) {
    const { data: group } = await admin
      .from<{ id: string; name: string }>("ingredient_groups")
      .select("id, name")
      .eq("account_id", accountId)
      .eq("id", product.group_id)
      .maybeSingle();
    groupName = group?.name ?? null;
  }

  const imageUrl = await signImageUrl(accountId, product.primary_image_file_id);

  return {
    id: product.id,
    externalId: product.external_id,
    name: product.name,
    itemTitle: product.item_title,
    groupId: product.group_id,
    groupName,
    article: product.article,
    barcode: product.barcode,
    measureUnitName: product.measure_unit_name,
    currentPrimeCost: product.current_prime_cost,
    storeQuantityKg: product.store_quantity_kg,
    stockLimit: product.stock_limit,
    localDescription: product.local_description,
    imageFileId: product.primary_image_file_id,
    imageUrl,
    syncedAt: product.synced_at,
    archivedAt: product.archived_at,
  };
}

export type CounterpartyOption = {
  id: string;
  name: string;
  inn: string | null;
};

export async function listAccountCounterparties(
  accountId: string,
): Promise<CounterpartyOption[]> {
  const admin = asLooseDb(createAdminClient());
  const { data } = await admin
    .from<Array<{ id: string; name: string; inn: string | null; deleted_at: string | null }>>(
      "counterparties",
    )
    .select("id, name, inn, deleted_at")
    .eq("account_id", accountId)
    .order("name", { ascending: true });
  return (data ?? [])
    .filter((row) => !row.deleted_at)
    .map((row) => ({ id: row.id, name: row.name, inn: row.inn }));
}

type CounterpartyJoin = {
  name: string;
  inn: string | null;
  kpp: string | null;
  phone: string | null;
  email: string | null;
  contact_person: string | null;
  address: string | null;
  description: string | null;
};

type SupplierRow = {
  id: string;
  counterparty_id: string;
  supplier_article: string | null;
  supplier_price: number | null;
  is_preferred: boolean;
  note: string | null;
  counterparties: CounterpartyJoin | CounterpartyJoin[] | null;
};

function oneRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function listIngredientSuppliers(
  accountId: string,
  ingredientId: string,
): Promise<IngredientSupplier[]> {
  const admin = asLooseDb(createAdminClient());
  const { data } = await admin
    .from<SupplierRow[]>("ingredient_suppliers")
    .select(
      "id, counterparty_id, supplier_article, supplier_price, is_preferred, note, counterparties(name, inn, kpp, phone, email, contact_person, address, description)",
    )
    .eq("account_id", accountId)
    .eq("ingredient_id", ingredientId)
    .order("is_preferred", { ascending: false });

  return (data ?? []).map((row) => {
    const cp = oneRelation(row.counterparties);
    return {
      id: row.id,
      counterpartyId: row.counterparty_id,
      counterpartyName: cp?.name ?? "—",
      counterpartyInn: cp?.inn ?? null,
      counterpartyKpp: cp?.kpp ?? null,
      counterpartyPhone: cp?.phone ?? null,
      counterpartyEmail: cp?.email ?? null,
      counterpartyContactPerson: cp?.contact_person ?? null,
      counterpartyAddress: cp?.address ?? null,
      counterpartyDescription: cp?.description ?? null,
      supplierArticle: row.supplier_article,
      supplierPrice: row.supplier_price,
      isPreferred: row.is_preferred,
      note: row.note,
    };
  });
}

type HistoryResortItemRow = InventoryResortItemSnapshotRow & {
  resort_id: string;
  document_id: string;
  document_item_id: string;
};

// Строка истории без итогов: «где встречается» и ничего больше.
const HISTORY_BASE_COLUMNS =
  "id, document_id, actual_amount, calculated_amount, measure_unit_name";

// Итоги строки. Отдельным списком, потому что без права на итоги их вообще не
// должно быть в ответе. Снимок берём целиком (факт и расчёт тоже), иначе у
// зафиксированного акта утверждённая разница сойдётся с уже другими слагаемыми.
const HISTORY_RESULT_COLUMNS =
  "difference_amount, difference_sum, prime_cost, excluded_from_totals, exclude_reason, " +
  "finalized_at, finalized_actual_amount, finalized_calculated_amount, " +
  "finalized_difference_amount, finalized_difference_sum, finalized_prime_cost, " +
  "finalized_excluded_from_totals";

// Embed идёт последним элементом списка. Два FK на documents (простой
// document_id + композитный tenant), поэтому дизамбигуируем по имени простого
// констрейнта. Имя обязано совпадать с текущим: до этого здесь стояло
// дореформенное `inventory_document_items_document_id_fkey`, переименованное
// миграцией 193, и PostgREST молча отдавал ошибку вместо строк — вкладка
// показывала «нет документов» для любой позиции.
const HISTORY_DOCUMENT_EMBED =
  "documents!document_items_document_id_fkey(document_number, invoice_date, status, results_finalized_at, results_reopened_at, results_snapshot_at)";

function historyColumns(canViewResults: boolean): string {
  return [HISTORY_BASE_COLUMNS, canViewResults ? HISTORY_RESULT_COLUMNS : null, HISTORY_DOCUMENT_EMBED]
    .filter(Boolean)
    .join(", ");
}

/**
 * История позиции по актам: где ушла в излишек, где в недостачу.
 *
 * Разницу берём фактическую — ту, что реально насчитали по строке. Управленческий
 * итог (исключения и пересорты) её как раз прячет, а вопрос здесь ровно
 * противоположный: где систематически путают позицию. Чтобы фактическое число не
 * читалось как претензия, строка несёт пометки `excluded` и `resort` — их
 * показывает карточка.
 *
 * `canViewResults` — право `inventory.view_results`. Разница, суммы, исключения и
 * пересорты закрыты именно им: страница итогов пускает по нему же, а читаем мы
 * admin-клиентом в обход RLS, так что без явной проверки право `view_products`
 * стало бы обходным путём к итогам.
 */
export async function listIngredientHistory(
  accountId: string,
  ingredientId: string,
  canViewResults: boolean,
): Promise<IngredientHistoryEntry[]> {
  const admin = asLooseDb(createAdminClient());
  const { data: itemRows } = await admin
    .from<IngredientHistoryItem[]>("document_items")
    .select(historyColumns(canViewResults))
    .eq("account_id", accountId)
    .eq("ingredient_id", ingredientId);

  const items = itemRows ?? [];
  if (items.length === 0) return [];
  if (!canViewResults) {
    return buildIngredientHistory(items, new Map(), new Set(), false);
  }

  // Пересорт закрывает недостачу излишком по соседней позиции, и тогда
  // фактический минус — не потеря. Связь идёт через строку акта: `ingredient_id`
  // на позиции пересорта — денормализованная обратная ссылка, у старых строк её
  // может не быть.
  const itemIds = items.map((row) => row.id);
  const { data: resortItemRows } = await admin
    .from<HistoryResortItemRow[]>("inventory_result_resort_items")
    .select(
      "resort_id, document_id, document_item_id, offset_amount, source_difference_amount, source_difference_sum, " +
        "remaining_difference_amount, remaining_difference_sum, " +
        "finalized_at, finalized_offset_amount, finalized_source_difference_amount, finalized_source_difference_sum, " +
        "finalized_remaining_difference_amount, finalized_remaining_difference_sum",
    )
    .eq("account_id", accountId)
    .in("document_item_id", itemIds);

  const frozenDocIds = frozenDocumentIds(items);

  // Аннулированные пересорты в расчёт не идут, но у зафиксированного акта статус
  // тоже берётся из снимка: пересорт, аннулированный после подведения итогов, из
  // утверждённой картины задним числом не исчезает (миграция 227).
  const resortItems = resortItemRows ?? [];
  const activeResortIds = new Set<string>();
  if (resortItems.length > 0) {
    const { data: resortRows } = await admin
      .from<Array<InventoryResortSnapshotRow & { id: string; document_id: string }>>(
        "inventory_result_resorts",
      )
      .select(
        "id, document_id, status, offset_amount, residual_shortfall_sum, residual_surplus_sum, cost_adjustment_sum, " +
          "finalized_at, finalized_status, finalized_offset_amount, finalized_residual_shortfall_sum, " +
          "finalized_residual_surplus_sum, finalized_cost_adjustment_sum",
      )
      .eq("account_id", accountId)
      .in("id", [...new Set(resortItems.map((row) => row.resort_id))]);

    for (const raw of resortRows ?? []) {
      const resort = applyResortSnapshot(raw, frozenDocIds.has(raw.document_id));
      if (resort.status === "active") activeResortIds.add(raw.id);
    }
  }

  const resortByItemId = new Map<string, IngredientHistoryResort>();
  for (const raw of resortItems) {
    if (!activeResortIds.has(raw.resort_id)) continue;
    const resortItem = applyResortItemSnapshot(raw, frozenDocIds.has(raw.document_id));
    resortByItemId.set(raw.document_item_id, {
      offsetAmount: Number(resortItem.offset_amount ?? 0),
      remainingDifferenceAmount: Number(resortItem.remaining_difference_amount ?? 0),
      remainingDifferenceSum: Number(resortItem.remaining_difference_sum ?? 0),
    });
  }

  return buildIngredientHistory(items, resortByItemId, frozenDocIds, true);
}

type JournalRow = {
  id: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  profiles:
    | { first_name: string | null; last_name: string | null }
    | { first_name: string | null; last_name: string | null }[]
    | null;
};

export async function listIngredientJournal(
  accountId: string,
  ingredientId: string,
  limit = 50,
): Promise<IngredientJournalEntry[]> {
  const admin = asLooseDb(createAdminClient());
  const { data } = await admin
    .from<JournalRow[]>("ingredient_journal")
    .select("id, event_type, payload, created_at, profiles:actor_id(first_name, last_name)")
    .eq("account_id", accountId)
    .eq("ingredient_id", ingredientId)
    .order("created_at", { ascending: false })
    .range(0, Math.max(0, limit - 1));

  return (data ?? []).map((row) => {
    const profile = oneRelation(row.profiles);
    const name = profile
      ? [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || null
      : null;
    return {
      id: row.id,
      eventType: row.event_type,
      payload: row.payload ?? {},
      actorName: name,
      createdAt: row.created_at,
    };
  });
}
