import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";

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

export type IngredientUsage = {
  documentId: string;
  documentNumber: string;
  invoiceDate: string | null;
  status: string;
  actualAmount: number | null;
  calculatedAmount: number | null;
};

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
): Promise<IngredientDetail | null> {
  const admin = asLooseDb(createAdminClient());
  const { data: product } = await admin
    .from<ProductRow>("ingredients")
    .select(
      "id, external_id, name, item_title, group_id, article, barcode, measure_unit_name, current_prime_cost, store_quantity_kg, stock_limit, local_description, primary_image_file_id, synced_at, archived_at",
    )
    .eq("account_id", accountId)
    .eq("id", ingredientId)
    // Карточка ингредиента не должна открываться по id позиции другого
    // типа (dish/product/semi_finished) — страница сделает redirect.
    .eq("kind", "ingredient")
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

type UsageItemRow = {
  document_id: string;
  actual_amount: number | null;
  calculated_amount: number | null;
  documents:
    | { document_number: string; invoice_date: string | null; status: string }
    | { document_number: string; invoice_date: string | null; status: string }[]
    | null;
};

export async function listIngredientUsage(
  accountId: string,
  ingredientId: string,
): Promise<IngredientUsage[]> {
  const admin = asLooseDb(createAdminClient());
  const { data } = await admin
    .from<UsageItemRow[]>("document_items")
    .select(
      // Два FK на documents (простой document_id + композитный tenant).
      // Дизамбигуируем embed по имени простого FK-констрейнта (имя пока
      // прежнее — ренейм констрейнтов в Pass 4.4), иначе PostgREST вернёт
      // ambiguous-relationship.
      "document_id, actual_amount, calculated_amount, documents!inventory_document_items_document_id_fkey(document_number, invoice_date, status)",
    )
    .eq("account_id", accountId)
    .eq("ingredient_id", ingredientId);

  return (data ?? []).map((row) => {
    const doc = oneRelation(row.documents);
    return {
      documentId: row.document_id,
      documentNumber: doc?.document_number ?? "—",
      invoiceDate: doc?.invoice_date ?? null,
      status: doc?.status ?? "—",
      actualAmount: row.actual_amount,
      calculatedAmount: row.calculated_amount,
    };
  });
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
