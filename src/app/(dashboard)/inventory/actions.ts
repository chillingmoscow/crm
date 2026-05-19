"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import { decryptSecret, encryptSecret } from "@/lib/integrations/crypto";
import {
  calculateResortAllocation,
  type InventoryResortAllocationItem,
} from "@/lib/inventory/results";
import {
  listIngredientTreeItems,
  listInventoryItemsBackOffice,
  listInventoryDocuments,
  listStores,
  loginQuickRestoBackOffice,
  readInventoryDocument,
  updateInventoryItemBackOffice,
  type QuickRestoInventoryDocument2,
  type QuickRestoInventoryItem2,
  type QuickRestoSingleCategory,
  type QuickRestoSingleProduct,
  type QuickRestoStore,
} from "@/lib/integrations/quickresto/client";

type QuickRestoConnection = {
  id: string;
  account_id: string;
  login: string;
  password_encrypted: string;
  password_iv: string;
  password_tag: string;
  backoffice_base_url: string | null;
  backoffice_login: string | null;
  backoffice_password_encrypted: string | null;
  backoffice_password_iv: string | null;
  backoffice_password_tag: string | null;
  backoffice_cookie_encrypted: string | null;
  backoffice_cookie_iv: string | null;
  backoffice_cookie_tag: string | null;
  backoffice_cookie_fetched_at: string | null;
  backoffice_last_tested_at: string | null;
};

type InventorySyncSummary = {
  groups: number;
  products: number;
  stores: number;
  documents: number;
  items: number;
  resultsBlocked: number;
};

type InventoryProductLookup = {
  id: string;
  external_id?: string;
  article?: string | null;
  barcode?: string | null;
};

type InventoryStoreLookup = {
  id: string;
  external_id?: string | null;
};

type InventoryExclusionRuleLookup = {
  id: string;
  inventory_product_id: string | null;
  external_product_id: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

type InventoryResultDocumentRow = {
  id: string;
  account_id: string;
  results_finalized_at: string | null;
};

type InventoryResultItemRow = {
  id: string;
  document_id: string;
  account_id: string;
  inventory_product_id: string | null;
  external_product_id: string | null;
  product_name: string;
  measure_unit_id: number | null;
  measure_unit_name: string | null;
  difference_amount: number | null;
  difference_sum: number | null;
  excluded_from_totals: boolean | null;
};

type InventoryResultProductGroupRow = {
  id: string;
  group_id: string | null;
};

type InventoryResultGroupRow = {
  id: string;
  name: string;
};

const INVENTORY_DOCUMENT_ITEM_KEYS = [
  "effectedItems",
  "prefabricatedItems",
  "disassembledItems",
] as const;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Принимает число или строку из формы (в т.ч. с запятой-разделителем).
function priceNum(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = value.trim().replace(",", ".");
    if (normalized === "") return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function className(value: unknown): string {
  return text(asObject(value).className) ?? "";
}

function isQuickRestoClass(value: unknown, suffix: "SingleCategory" | "SingleProduct") {
  return className(value).endsWith(`.${suffix}`);
}

function dateMs(value: unknown): number | null {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : null;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1_000_000_000_000 ? raw : raw * 1000;
  }

  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateText(value: unknown): string | null {
  const parsed = dateMs(value);
  return parsed === null ? null : new Date(parsed).toISOString();
}

function isDeletedQuickRestoRow(value: unknown) {
  const row = asObject(value);
  return (
    row.deleted === true ||
    row.isDeleted === true ||
    row.removed === true ||
    row.deletedAt != null ||
    row.deleteDate != null ||
    row.removeDate != null
  );
}

function isRecentOpenInventoryDocument(doc: QuickRestoInventoryDocument2) {
  if (doc.processed || isDeletedQuickRestoRow(doc)) return false;
  const invoiceDate = dateText(doc.invoiceDate);
  if (!invoiceDate) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  cutoff.setHours(0, 0, 0, 0);
  return Date.parse(invoiceDate) >= cutoff.getTime();
}

function sameDate(left: unknown, right: unknown) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  const leftMs = dateMs(left);
  const rightMs = dateMs(right);
  return leftMs !== null && rightMs !== null && leftMs === rightMs;
}

function productName(product: QuickRestoSingleProduct | QuickRestoInventoryItem2["product"], fallback: string) {
  return text(product?.name) ?? text(product?.itemTitle) ?? fallback;
}

function groupName(group: QuickRestoSingleCategory) {
  return text(group.name) ?? text(group.itemTitle) ?? `Группа #${group.id}`;
}

function storeTitle(store: QuickRestoStore) {
  return text(store.title) ?? `Склад #${store.id}`;
}

function inventoryDocumentNumber(doc: QuickRestoInventoryDocument2) {
  return text(doc.documentNumber) ?? `QR-${doc.id}`;
}

function externalProductId(item: QuickRestoInventoryItem2): string | null {
  const raw = asObject(item.product);
  const id = raw.id;
  return typeof id === "number" || typeof id === "string" ? String(id) : null;
}

function quickRestoObjectId(value: unknown): string | null {
  const row = asObject(value);
  const id = row.id;
  if (typeof id === "number" || typeof id === "string") return String(id);
  return null;
}

function quickRestoParentExternalId(item: unknown): string | null {
  const row = asObject(item);
  const selfId = quickRestoObjectId(row);
  const directKeys = ["parentId", "parentItemId", "parentGroupId", "parentCategoryId"];
  for (const key of directKeys) {
    const value = row[key];
    if (typeof value === "number" || typeof value === "string") {
      const id = String(value);
      if (id !== selfId) return id;
    }
  }

  const nestedKeys = [
    "parentItem",
    "parent",
    "parentGroup",
    "parentCategory",
    "group",
    "category",
    "singleCategory",
    "productGroup",
    "productCategory",
  ];
  for (const key of nestedKeys) {
    const id = quickRestoObjectId(row[key]);
    if (id && id !== selfId) return id;
  }

  return null;
}

function externalItemId(item: QuickRestoInventoryItem2, index: number): string {
  if (typeof item.id === "number" || typeof item.id === "string") return String(item.id);
  const productId = externalProductId(item);
  return productId ? `product:${productId}` : `row:${index}`;
}

function inventoryDocumentItems(document: QuickRestoInventoryDocument2) {
  for (const key of INVENTORY_DOCUMENT_ITEM_KEYS) {
    const value = document[key];
    if (Array.isArray(value) && value.length > 0) {
      return { key, items: value as QuickRestoInventoryItem2[] };
    }
  }
  return { key: "effectedItems" as const, items: [] as QuickRestoInventoryItem2[] };
}

function getNestedNumber(item: QuickRestoInventoryItem2, keys: string[]) {
  const row = asObject(item);
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function extractLineResult(item: QuickRestoInventoryItem2) {
  const calculatedAmount = getNestedNumber(item, [
    "calculatedAmount",
    "expectedAmount",
    "theoreticalAmount",
    "bookAmount",
    "accountingAmount",
    "storeAmount",
    "amountAtStore",
    "storeQuantity",
    "storeQuantityKg",
  ]);
  const differenceAmount = getNestedNumber(item, [
    "differenceAmount",
    "diffAmount",
    "deltaAmount",
    "delta",
    "shortfallAmount",
    "surplusAmount",
    "deviationAmount",
  ]);
  const primeCost = getNestedNumber(item, [
    "primeCost",
    "currentPrimeCost",
    "costPrice",
    "cost",
  ]);
  const differenceSum = getNestedNumber(item, [
    "differenceSum",
    "diffSum",
    "deltaSum",
    "differenceCost",
    "shortfallSum",
    "surplusSum",
    "deviationSum",
  ]);

  return {
    calculatedAmount,
    differenceAmount,
    primeCost,
    differenceSum,
    hasResult:
      calculatedAmount !== null ||
      differenceAmount !== null ||
      differenceSum !== null,
  };
}

function buildStoragePath(accountId: string, originalName: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const uuid = crypto.randomUUID();
  const safe = originalName.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";
  return `${accountId}/${yyyy}/${mm}/${uuid}-${safe}`;
}

function actionErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

async function getActiveContext(permission?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, accountId: null, venueId: null, error: "Не авторизован" };

  const { data: accountId, error: accountError } = await supabase.rpc("get_active_account_id");
  if (accountError || !accountId) {
    return { supabase, user, accountId: null, venueId: null, error: "Не удалось определить активный аккаунт" };
  }

  const { data: venueId } = await supabase.rpc("get_active_venue_id");

  if (permission) {
    const { data: allowed } = await supabase.rpc("has_permission", { permission_code: permission });
    if (!allowed) {
      return {
        supabase,
        user,
        accountId: accountId as string,
        venueId: (venueId as string | null) ?? null,
        error: "Недостаточно прав",
      };
    }
  }

  return {
    supabase,
    user,
    accountId: accountId as string,
    venueId: (venueId as string | null) ?? null,
    error: null,
  };
}

async function resolveDefaultVenueId(input: {
  admin: LooseDb;
  accountId: string;
  activeVenueId: string | null;
}) {
  if (input.activeVenueId) {
    const { data: activeVenue } = await input.admin
      .from<{ id: string }>("venues")
      .select("id")
      .eq("id", input.activeVenueId)
      .eq("account_id", input.accountId)
      .maybeSingle();
    if (activeVenue?.id) return activeVenue.id;
  }

  const { data: venues } = await input.admin
    .from<Array<{ id: string }>>("venues")
    .select("id")
    .eq("account_id", input.accountId);
  return venues?.length === 1 ? venues[0].id : null;
}

async function getConnection(accountId: string): Promise<QuickRestoConnection | null> {
  const admin = asLooseDb(createAdminClient());
  const { data } = await admin
    .from("integration_connections")
    .select(
      [
        "id",
        "account_id",
        "login",
        "password_encrypted",
        "password_iv",
        "password_tag",
        "backoffice_base_url",
        "backoffice_login",
        "backoffice_password_encrypted",
        "backoffice_password_iv",
        "backoffice_password_tag",
        "backoffice_cookie_encrypted",
        "backoffice_cookie_iv",
        "backoffice_cookie_tag",
        "backoffice_cookie_fetched_at",
        "backoffice_last_tested_at",
      ].join(", ")
    )
    .eq("account_id", accountId)
    .eq("provider", "quickresto")
    .eq("status", "active")
    .maybeSingle();

  return (data as QuickRestoConnection | null) ?? null;
}

function connectionPassword(connection: QuickRestoConnection) {
  return decryptSecret({
    encrypted: connection.password_encrypted,
    iv: connection.password_iv,
    tag: connection.password_tag,
  });
}

function decryptNullableSecret(payload: {
  encrypted: string | null;
  iv: string | null;
  tag: string | null;
}) {
  if (!payload.encrypted || !payload.iv || !payload.tag) return null;
  return decryptSecret({
    encrypted: payload.encrypted,
    iv: payload.iv,
    tag: payload.tag,
  });
}

function hasBackOfficePassword(connection: QuickRestoConnection) {
  return Boolean(
    connection.backoffice_login?.trim() &&
      connection.backoffice_password_encrypted &&
      connection.backoffice_password_iv &&
      connection.backoffice_password_tag
  );
}

function isBackOfficeAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Quick Resto back-office auth failed") ||
    message.includes("Неверный логин или пароль back-office")
  );
}

async function refreshBackOfficeCookie(input: {
  connection: QuickRestoConnection;
  admin: LooseDb;
}) {
  if (!hasBackOfficePassword(input.connection)) {
    throw new Error(
      "Настройте back-office доступ Quick Resto для пользователя Sheerly Bot перед отправкой акта."
    );
  }

  const password = decryptNullableSecret({
    encrypted: input.connection.backoffice_password_encrypted,
    iv: input.connection.backoffice_password_iv,
    tag: input.connection.backoffice_password_tag,
  });
  if (!password) {
    throw new Error(
      "Настройте back-office доступ Quick Resto для пользователя Sheerly Bot перед отправкой акта."
    );
  }

  const session = await loginQuickRestoBackOffice({
    layerName: input.connection.login,
    baseUrl: input.connection.backoffice_base_url,
    login: input.connection.backoffice_login?.trim() ?? "",
    password,
  });
  const encryptedCookie = encryptSecret(session.cookieHeader);
  const now = new Date().toISOString();

  await input.admin
    .from("integration_connections")
    .update({
      backoffice_cookie_encrypted: encryptedCookie.encrypted,
      backoffice_cookie_iv: encryptedCookie.iv,
      backoffice_cookie_tag: encryptedCookie.tag,
      backoffice_cookie_fetched_at: now,
      backoffice_last_tested_at: now,
      updated_at: now,
    })
    .eq("id", input.connection.id);

  input.connection.backoffice_cookie_encrypted = encryptedCookie.encrypted;
  input.connection.backoffice_cookie_iv = encryptedCookie.iv;
  input.connection.backoffice_cookie_tag = encryptedCookie.tag;
  input.connection.backoffice_cookie_fetched_at = now;
  input.connection.backoffice_last_tested_at = now;

  return session.cookieHeader;
}

async function getBackOfficeCookie(input: {
  connection: QuickRestoConnection;
  admin: LooseDb;
}) {
  const cookie = decryptNullableSecret({
    encrypted: input.connection.backoffice_cookie_encrypted,
    iv: input.connection.backoffice_cookie_iv,
    tag: input.connection.backoffice_cookie_tag,
  });
  if (cookie) return cookie;
  return refreshBackOfficeCookie(input);
}

async function listBackOfficeInventoryItemsWithSession(input: {
  connection: QuickRestoConnection;
  admin: LooseDb;
  documentExternalId: number;
}) {
  let cookieHeader = await getBackOfficeCookie({
    connection: input.connection,
    admin: input.admin,
  });

  const readRows = (cookie: string) =>
    listInventoryItemsBackOffice({
      layerName: input.connection.login,
      baseUrl: input.connection.backoffice_base_url,
      cookieHeader: cookie,
      documentId: input.documentExternalId,
    });

  try {
    return await readRows(cookieHeader);
  } catch (error) {
    if (!isBackOfficeAuthError(error)) throw error;
    cookieHeader = await refreshBackOfficeCookie({
      connection: input.connection,
      admin: input.admin,
    });
    return readRows(cookieHeader);
  }
}

async function upsertExternalLink(input: {
  accountId: string;
  entityType: string;
  externalId: string;
  localTable: string;
  localId: string;
}) {
  const admin = asLooseDb(createAdminClient());
  await admin.from("external_entity_links").upsert(
    {
      account_id: input.accountId,
      provider: "quickresto",
      entity_type: input.entityType,
      external_id: input.externalId,
      local_table: input.localTable,
      local_id: input.localId,
    },
    { onConflict: "account_id,provider,entity_type,external_id" }
  );
}

async function saveSnapshot(input: {
  accountId: string;
  entityType: string;
  externalId: string;
  payload: unknown;
}) {
  const admin = asLooseDb(createAdminClient());
  await admin.from("integration_external_snapshots").upsert(
    {
      account_id: input.accountId,
      provider: "quickresto",
      entity_type: input.entityType,
      external_id: input.externalId,
      payload: input.payload,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "account_id,provider,entity_type,external_id" }
  );
}

async function syncDocumentItems(input: {
  admin: LooseDb;
  accountId: string;
  documentId: string;
  items: QuickRestoInventoryItem2[];
  productByExternalId: Map<string, InventoryProductLookup>;
  submittedAmounts?: Map<string, number | null>;
}) {
  let resultsFound = false;
  const { data: exclusionRulesRaw } = await input.admin
    .from<InventoryExclusionRuleLookup[]>("inventory_result_exclusion_rules")
    .select("id, inventory_product_id, external_product_id, reason, created_by, created_at")
    .eq("account_id", input.accountId)
    .eq("status", "active");
  const exclusionRuleByProductId = new Map(
    (exclusionRulesRaw ?? [])
      .filter((rule) => rule.inventory_product_id)
      .map((rule) => [rule.inventory_product_id as string, rule]),
  );
  const exclusionRuleByExternalProductId = new Map(
    (exclusionRulesRaw ?? [])
      .filter((rule) => rule.external_product_id)
      .map((rule) => [rule.external_product_id as string, rule]),
  );

  const rows = input.items.map((item, index) => {
    const productId = externalProductId(item);
    const localProduct = productId ? input.productByExternalId.get(productId) : null;
    const exclusionRule =
      (localProduct?.id ? exclusionRuleByProductId.get(localProduct.id) : null) ??
      (productId ? exclusionRuleByExternalProductId.get(productId) : null);
    const product = item.product ?? {};
    const result = extractLineResult(item);
    if (result.hasResult) resultsFound = true;
    const itemExternalId = externalItemId(item, index);

    return {
      account_id: input.accountId,
      document_id: input.documentId,
      external_item_id: itemExternalId,
      inventory_product_id: localProduct?.id ?? null,
      external_product_id: productId,
      product_name:
        text(item.productName) ??
        text(item.title) ??
        productName(product, productId ? `Позиция #${productId}` : `Позиция ${index + 1}`),
      article: text(item.article) ?? text(product.article) ?? localProduct?.article ?? null,
      barcode: text(item.barCode) ?? text(product.barCode) ?? localProduct?.barcode ?? null,
      measure_unit_id: typeof item.measureUnit?.id === "number" ? item.measureUnit.id : null,
      measure_unit_name: text(item.measureUnitName) ?? text(item.measureUnit?.name) ?? text(item.measureUnit?.title),
      actual_amount: num(item.actualAmount),
      submitted_amount: input.submittedAmounts?.has(itemExternalId)
        ? input.submittedAmounts.get(itemExternalId)
        : null,
      calculated_amount: result.calculatedAmount,
      difference_amount: result.differenceAmount,
      prime_cost: result.primeCost,
      difference_sum: result.differenceSum,
      sort_order: index,
      raw_payload: item,
      result_payload: result.hasResult ? item : {},
      ...(exclusionRule
        ? {
            excluded_from_totals: true,
            exclude_reason: exclusionRule.reason,
            excluded_by: exclusionRule.created_by,
            excluded_at: exclusionRule.created_at,
          }
        : {}),
    };
  });

  if (rows.length > 0) {
    const { error } = await input.admin
      .from("inventory_document_items")
      .upsert(rows, { onConflict: "document_id,external_item_id" });
    if (error) throw new Error(error.message);

    const keepExternalIds = new Set(rows.map((row) => row.external_item_id));
    const { data: existingRows } = await input.admin
      .from<Array<{ external_item_id: string }>>("inventory_document_items")
      .select("external_item_id")
      .eq("document_id", input.documentId);
    const staleExternalIds = (existingRows ?? [])
      .map((row) => row.external_item_id)
      .filter((externalId) => !keepExternalIds.has(externalId));
    if (staleExternalIds.length > 0) {
      await input.admin
        .from("inventory_document_items")
        .delete()
        .eq("document_id", input.documentId)
        .in("external_item_id", staleExternalIds);
    }
  } else {
    await input.admin.from("inventory_document_items").delete().eq("document_id", input.documentId);
  }

  return { count: rows.length, resultsFound };
}

async function refreshLocalInventoryDocumentFromPayload(input: {
  admin: LooseDb;
  accountId: string;
  documentId: string;
  document: QuickRestoInventoryDocument2;
  status?: string;
  submittedAmounts?: Map<string, number | null>;
}) {
  const itemsPreview = inventoryDocumentItems(input.document);
  const productRows = await input.admin
    .from<InventoryProductLookup[]>("inventory_products")
    .select("id, external_id, article, barcode")
    .eq("account_id", input.accountId);
  const productByExternalId = new Map(
    ((productRows.data ?? []) as InventoryProductLookup[]).map((row) => [String(row.external_id), row])
  );
  const syncResult = await syncDocumentItems({
    admin: input.admin,
    accountId: input.accountId,
    documentId: input.documentId,
    items: itemsPreview.items,
    productByExternalId,
    submittedAmounts: input.submittedAmounts,
  });
  const status =
    input.status ??
    (input.document.processed
      ? "processed"
      : syncResult.resultsFound
        ? "ready_for_review"
        : "results_blocked");

  const { error } = await input.admin
    .from("inventory_documents")
    .update({
      status,
      processed: Boolean(input.document.processed),
      base_last_update_date: dateText(input.document.lastUpdateDate),
      last_qr_update_date: dateText(input.document.lastUpdateDate),
      shortfall_sum: num(input.document.shortfallSum),
      surplus_sum: num(input.document.surplusSum),
      results_has_line_amounts: syncResult.resultsFound,
      qr_payload: input.document,
      synced_at: new Date().toISOString(),
    })
    .eq("id", input.documentId)
    .eq("account_id", input.accountId);
  if (error) throw new Error(error.message);

  return syncResult;
}

function amountsEqual(left: number | null | undefined, right: number | null | undefined) {
  if (left === null || left === undefined || right === null || right === undefined) {
    return left === right;
  }
  return Math.abs(left - right) < 0.000001;
}

function readActualAmountsByExternalItemId(items: QuickRestoInventoryItem2[]) {
  const amounts = new Map<string, number | null>();
  items.forEach((item, index) => {
    amounts.set(externalItemId(item, index), num(item.actualAmount));
  });
  return amounts;
}

function normalizeReason(value: string | null | undefined, fallback = "Укажите причину") {
  const reason = text(value);
  if (!reason) throw new Error(fallback);
  return reason;
}

function resultItemMeasureKey(item: InventoryResultItemRow) {
  if (typeof item.measure_unit_id === "number") return `id:${item.measure_unit_id}`;
  return `name:${item.measure_unit_name ?? ""}`;
}

async function getResultDocumentForAction(input: {
  admin: LooseDb;
  accountId: string;
  documentId: string;
  requireOpen?: boolean;
}) {
  const { data: document } = await input.admin
    .from<InventoryResultDocumentRow>("inventory_documents")
    .select("id, account_id, results_finalized_at")
    .eq("id", input.documentId)
    .eq("account_id", input.accountId)
    .maybeSingle();

  if (!document?.id) throw new Error("Акт не найден");
  if (input.requireOpen && document.results_finalized_at) {
    throw new Error("Итоги акта уже финализированы. Переоткройте итоги перед изменениями.");
  }
  return document;
}

async function writeInventoryResultEvent(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  admin: LooseDb;
  accountId: string;
  userId: string;
  documentId: string;
  documentItemId?: string | null;
  resortId?: string | null;
  eventType: string;
  message: string;
  payload?: Record<string, unknown>;
}) {
  const payload = input.payload ?? {};
  await input.admin.from("inventory_result_events").insert({
    account_id: input.accountId,
    document_id: input.documentId,
    document_item_id: input.documentItemId ?? null,
    resort_id: input.resortId ?? null,
    event_type: input.eventType,
    message: input.message,
    payload,
    created_by: input.userId,
  });
  await input.supabase.rpc("log_audit", {
    p_action_code: `inventory.${input.eventType}`,
    p_entity_type: "inventory_document",
    p_entity_id: input.documentId,
    p_details: payload as never,
  });
}

async function getActiveResortItemIds(input: {
  admin: LooseDb;
  accountId: string;
  documentId: string;
  itemIds?: string[];
}) {
  const { data: activeResorts } = await input.admin
    .from<Array<{ id: string }>>("inventory_result_resorts")
    .select("id")
    .eq("account_id", input.accountId)
    .eq("document_id", input.documentId)
    .eq("status", "active");
  const resortIds = (activeResorts ?? []).map((row) => row.id);
  if (resortIds.length === 0) return new Set<string>();

  let query = input.admin
    .from<Array<{ document_item_id: string }>>("inventory_result_resort_items")
    .select("document_item_id")
    .eq("account_id", input.accountId)
    .eq("document_id", input.documentId)
    .in("resort_id", resortIds);
  if (input.itemIds && input.itemIds.length > 0) {
    query = query.in("document_item_id", input.itemIds);
  }
  const { data } = await query;
  return new Set((data ?? []).map((row) => row.document_item_id));
}

async function loadResultItemsForAdjustment(input: {
  admin: LooseDb;
  accountId: string;
  documentId: string;
  itemIds: string[];
}) {
  const uniqueItemIds = Array.from(new Set(input.itemIds));
  const { data: items } = await input.admin
    .from<InventoryResultItemRow[]>("inventory_document_items")
    .select(
      "id, document_id, account_id, inventory_product_id, external_product_id, product_name, measure_unit_id, measure_unit_name, difference_amount, difference_sum, excluded_from_totals"
    )
    .eq("account_id", input.accountId)
    .eq("document_id", input.documentId)
    .in("id", uniqueItemIds);
  const rows = (items ?? []) as InventoryResultItemRow[];
  if (rows.length !== uniqueItemIds.length) throw new Error("Одна или несколько строк акта не найдены");
  return rows;
}

async function resolveResultItemGroup(input: {
  admin: LooseDb;
  accountId: string;
  items: InventoryResultItemRow[];
}) {
  const productIds = input.items
    .map((item) => item.inventory_product_id)
    .filter((id): id is string => Boolean(id));
  if (productIds.length === 0) throw new Error("Для пересорта нужны позиции, связанные с ингредиентами");

  const { data: products } = await input.admin
    .from<InventoryResultProductGroupRow[]>("inventory_products")
    .select("id, group_id")
    .eq("account_id", input.accountId)
    .in("id", productIds);
  const groupByProductId = new Map((products ?? []).map((product) => [product.id, product.group_id]));
  const groupIds = new Set(
    input.items.map((item) => item.inventory_product_id ? groupByProductId.get(item.inventory_product_id) ?? null : null)
  );
  if (groupIds.size !== 1) throw new Error("Для пересорта можно выбрать позиции только одной группы");
  const groupId = Array.from(groupIds)[0];
  if (!groupId) throw new Error("Для пересорта нужны позиции с группой ингредиентов");

  const { data: group } = await input.admin
    .from<InventoryResultGroupRow>("inventory_product_groups")
    .select("id, name")
    .eq("id", groupId)
    .eq("account_id", input.accountId)
    .maybeSingle();
  if (!group?.id) throw new Error("Группа выбранных позиций не найдена");
  return group;
}

function revalidateInventoryResultPages(documentId: string) {
  revalidatePath("/inventory/documents");
  revalidatePath(`/inventory/documents/${documentId}`);
  revalidatePath(`/inventory/documents/${documentId}/results`);
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

    const groupExternalIds = groups
      .map((group) => (typeof group.id === "number" ? String(group.id) : null))
      .filter((id): id is string => Boolean(id));
    const productExternalIds = products
      .map((product) => (typeof product.id === "number" ? String(product.id) : null))
      .filter((id): id is string => Boolean(id));
    if (groupExternalIds.length > 0) {
      await admin
        .from("inventory_products")
        .delete()
        .eq("account_id", ctx.accountId)
        .in("external_id", groupExternalIds);
    }
    if (productExternalIds.length > 0) {
      await admin
        .from("inventory_product_groups")
        .delete()
        .eq("account_id", ctx.accountId)
        .in("external_id", productExternalIds);
    }

    for (const group of groups) {
      if (typeof group.id !== "number") continue;
      const parentExternalId = quickRestoParentExternalId(group);

      const { data, error } = await admin
        .from<{ id: string }>("inventory_product_groups")
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
        accountId: ctx.accountId,
        entityType: "ingredient_group",
        externalId: String(group.id),
        localTable: "inventory_product_groups",
        localId: data.id,
      });
      await saveSnapshot({ accountId: ctx.accountId, entityType: "ingredient_group", externalId: String(group.id), payload: group });
    }

    for (const group of groups) {
      const localId = groupByExternalId.get(String(group.id));
      const parentExternalId = quickRestoParentExternalId(group);
      const parentId = parentExternalId ? groupByExternalId.get(parentExternalId) : null;
      if (localId) {
        await admin
          .from("inventory_product_groups")
          .update({ parent_group_id: parentId ?? null })
          .eq("id", localId);
      }
    }

    for (const product of products) {
      if (typeof product.id !== "number") continue;
      const parentExternalId = quickRestoParentExternalId(product);
      const groupId = parentExternalId ? groupByExternalId.get(parentExternalId) ?? null : null;

      const { data, error } = await admin
        .from<InventoryProductLookup>("inventory_products")
        .upsert(
          {
            account_id: ctx.accountId,
            external_id: String(product.id),
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
        accountId: ctx.accountId,
        entityType: "ingredient",
        externalId: String(product.id),
        localTable: "inventory_products",
        localId: data.id,
      });
      await saveSnapshot({ accountId: ctx.accountId, entityType: "ingredient", externalId: String(product.id), payload: product });
    }

    // Soft-archive ингредиентов, пропавших из QuickResto. Не удаляем:
    // сохраняем историю в актах, локальные поля, поставщиков, журнал.
    // Вернувшиеся в выгрузку — разархивируем.
    {
      const incoming = new Set(productExternalIds);
      const { data: localProducts } = await admin
        .from<Array<{ id: string; external_id: string; archived_at: string | null }>>(
          "inventory_products",
        )
        .select("id, external_id, archived_at")
        .eq("account_id", ctx.accountId);
      const toArchive = (localProducts ?? [])
        .filter((p) => p.external_id && !incoming.has(p.external_id) && !p.archived_at)
        .map((p) => p.id);
      const toUnarchive = (localProducts ?? [])
        .filter((p) => p.external_id && incoming.has(p.external_id) && p.archived_at)
        .map((p) => p.id);
      if (toArchive.length > 0) {
        await admin
          .from("inventory_products")
          .update({ archived_at: syncedAt })
          .in("id", toArchive);
      }
      if (toUnarchive.length > 0) {
        await admin
          .from("inventory_products")
          .update({ archived_at: null })
          .in("id", toUnarchive);
      }
    }

    for (const store of stores) {
      if (typeof store.id !== "number") continue;
      const { data: existingStore } = await admin
        .from<{ id: string; local_venue_id: string | null }>("inventory_stores")
        .select("id, local_venue_id")
        .eq("account_id", ctx.accountId)
        .eq("external_id", String(store.id))
        .maybeSingle();
      const { data, error } = await admin
        .from<{ id: string }>("inventory_stores")
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
        accountId: ctx.accountId,
        entityType: "store",
        externalId: String(store.id),
        localTable: "inventory_stores",
        localId: data.id,
      });
      await saveSnapshot({ accountId: ctx.accountId, entityType: "store", externalId: String(store.id), payload: store });
    }
  } else {
    const [{ data: productRows }, { data: storeRows }, loadedDocuments] = await Promise.all([
      admin
        .from<InventoryProductLookup[]>("inventory_products")
        .select("id, external_id, article, barcode")
        .eq("account_id", ctx.accountId),
      admin
        .from<InventoryStoreLookup[]>("inventory_stores")
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
    const document = await readInventoryDocument({ ...auth, objectId: documentListItem.id });
    const externalStoreId = typeof document.store?.id === "number" ? String(document.store.id) : null;
    const storeId = externalStoreId ? storeByExternalId.get(externalStoreId) ?? null : null;

    const { data: existing } = await admin
      .from<{ id: string; status: string }>("inventory_documents")
      .select("id, status")
      .eq("account_id", ctx.accountId)
      .eq("external_id", String(document.id))
      .maybeSingle();

    const nextStatus = document.processed
      ? "processed"
      : existing?.status && existing.status !== "processed"
        ? existing.status
        : "synced";

    const { items } = inventoryDocumentItems(document);
    const precheckHasResults = items.some((item) => extractLineResult(item).hasResult);

    const { data, error } = await admin
      .from<{ id: string }>("inventory_documents")
      .upsert(
        {
          account_id: ctx.accountId,
          external_id: String(document.id),
          document_number: inventoryDocumentNumber(document),
          invoice_date: dateText(document.invoiceDate),
          store_id: storeId,
          external_store_id: externalStoreId,
          status: nextStatus,
          processed: Boolean(document.processed),
          base_last_update_date: dateText(document.lastUpdateDate),
          last_qr_update_date: dateText(document.lastUpdateDate),
          shortfall_sum: num(document.shortfallSum),
          surplus_sum: num(document.surplusSum),
          results_has_line_amounts: precheckHasResults,
          comment: text(document.comment),
          qr_payload: document,
          synced_at: syncedAt,
        },
        { onConflict: "account_id,external_id" }
      )
      .select("id")
      .single();
    if (error || !data?.id) throw new Error(error?.message ?? `Не удалось сохранить акт ${document.id}`);

    if (items.length > 0) {
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
          .from("inventory_documents")
          .update({ results_has_line_amounts: result.resultsFound })
          .eq("id", data.id);
      }
    }

    summary.documents += 1;
    await upsertExternalLink({
      accountId: ctx.accountId,
      entityType: "inventory_document",
      externalId: String(document.id),
      localTable: "inventory_documents",
      localId: data.id,
    });
    await saveSnapshot({ accountId: ctx.accountId, entityType: "inventory_document", externalId: String(document.id), payload: document });
  }

  revalidatePath("/inventory");
  if (scope === "full") {
    revalidatePath("/inventory/categories");
    revalidatePath("/inventory/products");
    revalidatePath("/inventory/stores");
  }
  revalidatePath("/inventory/documents");
  return { summary, error: null };
  } catch (error) {
    return {
      summary: null,
      error: actionErrorMessage(error, "Не удалось синхронизировать Quick Resto"),
    };
  }
}

export async function assignInventoryDocument(input: {
  documentId: string;
  assignedTo: string | null;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.manage_documents");
  if (ctx.error || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  const { error } = await admin
    .from("inventory_documents")
    .update({
      assigned_to: input.assignedTo,
      status: input.assignedTo ? "assigned" : "synced",
    })
    .eq("id", input.documentId)
    .eq("account_id", ctx.accountId);

  if (error) return { error: error.message };
  revalidatePath("/inventory/documents");
  revalidatePath(`/inventory/documents/${input.documentId}`);
  return { error: null };
}

export async function refreshInventoryDocumentResults(input: {
  documentId: string;
}): Promise<{
  processed: boolean;
  resultsHasLineAmounts: boolean;
  error: string | null;
}> {
  const ctx = await getActiveContext();
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
  const { data: document } = await admin
    .from<{
      id: string;
      account_id: string;
      external_id: string;
      assigned_to: string | null;
    }>("inventory_documents")
    .select("id, account_id, external_id, assigned_to")
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

    revalidatePath("/inventory/documents");
    revalidatePath(`/inventory/documents/${document.id}`);
    revalidatePath(`/inventory/documents/${document.id}/results`);

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
  const ctx = await getActiveContext("inventory.comment_results");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    await getResultDocumentForAction({
      admin,
      accountId: ctx.accountId,
      documentId: input.documentId,
      requireOpen: true,
    });

    const comment = text(input.comment);
    const { data: item } = await admin
      .from<{ id: string; product_name: string }>("inventory_document_items")
      .select("id, product_name")
      .eq("id", input.itemId)
      .eq("document_id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!item?.id) throw new Error("Строка акта не найдена");

    const { error } = await admin
      .from("inventory_document_items")
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

export async function setInventoryResultItemExcluded(input: {
  documentId: string;
  itemId: string;
  excluded: boolean;
  reason?: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.adjust_results");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    await getResultDocumentForAction({
      admin,
      accountId: ctx.accountId,
      documentId: input.documentId,
      requireOpen: true,
    });
    const { data: item } = await admin
      .from<{ id: string; product_name: string }>("inventory_document_items")
      .select("id, product_name")
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

    const reason = input.excluded ? text(input.reason) : null;
    const now = new Date().toISOString();
    const { error } = await admin
      .from("inventory_document_items")
      .update({
        excluded_from_totals: input.excluded,
        exclude_reason: reason,
        excluded_by: input.excluded ? ctx.user.id : null,
        excluded_at: input.excluded ? now : null,
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
  const ctx = await getActiveContext("inventory.adjust_results");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    await getResultDocumentForAction({
      admin,
      accountId: ctx.accountId,
      documentId: input.documentId,
      requireOpen: true,
    });
    const { data: item } = await admin
      .from<InventoryResultItemRow>("inventory_document_items")
      .select("id, document_id, account_id, inventory_product_id, external_product_id, product_name, measure_unit_id, measure_unit_name, difference_amount, difference_sum, excluded_from_totals")
      .eq("id", input.itemId)
      .eq("document_id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!item?.id) throw new Error("Строка акта не найдена");
    if (!item.inventory_product_id && !item.external_product_id) {
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
      .select("id, inventory_product_id, external_product_id, reason, created_by, created_at")
      .eq("account_id", ctx.accountId)
      .eq("status", "active");
    if (item.inventory_product_id) {
      existingRuleQuery = existingRuleQuery.eq("inventory_product_id", item.inventory_product_id);
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
            inventory_product_id: item.inventory_product_id,
            external_product_id: item.external_product_id,
            product_name: item.product_name,
            reason,
            created_by: ctx.user.id,
          })
          .select("id, inventory_product_id, external_product_id, reason, created_by, created_at")
          .single();
    if (ruleError || !rule?.id) throw new Error(ruleError?.message ?? "Не удалось создать правило автоисключения");

    const now = new Date().toISOString();
    const { error: itemError } = await admin
      .from("inventory_document_items")
      .update({
        excluded_from_totals: true,
        exclude_reason: reason,
        excluded_by: ctx.user.id,
        excluded_at: now,
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
  const ctx = await getActiveContext("inventory.adjust_results");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    await getResultDocumentForAction({
      admin,
      accountId: ctx.accountId,
      documentId: input.documentId,
      requireOpen: true,
    });
    const reason = normalizeReason(input.reason, "Укажите причину удаления автоисключения");
    const { data: item } = await admin
      .from<InventoryResultItemRow>("inventory_document_items")
      .select("id, document_id, account_id, inventory_product_id, external_product_id, product_name, measure_unit_id, measure_unit_name, difference_amount, difference_sum, excluded_from_totals")
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
    if (item.inventory_product_id) {
      ruleQuery = ruleQuery.eq("inventory_product_id", item.inventory_product_id);
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

    const { error: itemError } = await admin
      .from("inventory_document_items")
      .update({
        excluded_from_totals: false,
        exclude_reason: null,
        excluded_by: null,
        excluded_at: null,
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
      eventType: "persistent_exclusion_disabled",
      message: `Автоисключение позиции «${item.product_name}» удалено`,
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
  const ctx = await getActiveContext("inventory.adjust_results");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    await getResultDocumentForAction({
      admin,
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
        inventory_product_id: item.inventory_product_id,
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
    if (itemsError) throw new Error(itemsError.message);

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
  const ctx = await getActiveContext("inventory.adjust_results");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    await getResultDocumentForAction({
      admin,
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
    if (resort.status !== "active") throw new Error("Пересорт уже отменен");

    const { error } = await admin
      .from("inventory_result_resorts")
      .update({
        status: "voided",
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
  const ctx = await getActiveContext("inventory.adjust_results");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    await getResultDocumentForAction({
      admin,
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

export async function finalizeInventoryResults(input: {
  documentId: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.finalize_results");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    const document = await getResultDocumentForAction({
      admin,
      accountId: ctx.accountId,
      documentId: input.documentId,
    });
    if (document.results_finalized_at) return { error: null };

    const { error } = await admin
      .from("inventory_documents")
      .update({
        results_finalized_at: new Date().toISOString(),
        results_finalized_by: ctx.user.id,
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
      message: "Подвел итоги акта",
      payload: { documentId: document.id },
    });

    revalidateInventoryResultPages(document.id);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось финализировать итоги") };
  }
}

export async function reopenInventoryResults(input: {
  documentId: string;
  reason: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.finalize_results");
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    const reason = normalizeReason(input.reason, "Укажите причину переоткрытия итогов");
    const document = await getResultDocumentForAction({
      admin,
      accountId: ctx.accountId,
      documentId: input.documentId,
    });
    if (!document.results_finalized_at) return { error: null };

    const { error } = await admin
      .from("inventory_documents")
      .update({
        results_finalized_at: null,
        results_finalized_by: null,
        results_reopened_at: new Date().toISOString(),
        results_reopened_by: ctx.user.id,
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
      message: "Открыл итоги для редактирования",
      payload: { documentId: document.id, reason },
    });

    revalidateInventoryResultPages(document.id);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось переоткрыть итоги") };
  }
}

export async function updateInventoryStoreVenue(input: {
  storeId: string;
  venueId: string | null;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext("inventory.manage_stores");
  if (ctx.error || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  const { error } = await admin
    .from("inventory_stores")
    .update({ local_venue_id: input.venueId || null })
    .eq("id", input.storeId)
    .eq("account_id", ctx.accountId);

  if (error) return { error: error.message };
  revalidatePath("/inventory/stores");
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
    .from<{ id: string }>("inventory_products")
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
    .from("inventory_products")
    .update({ primary_image_file_id: fileRow.id })
    .eq("id", productId)
    .eq("account_id", ctx.accountId);
  if (productError) return { error: productError.message };

  revalidatePath("/inventory/products");
  revalidatePath(`/inventory/products/${productId}`);
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
    .from<{ id: string }>("inventory_product_groups")
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
    .from("inventory_product_groups")
    .update({ primary_image_file_id: fileRow.id })
    .eq("id", groupId)
    .eq("account_id", ctx.accountId);
  if (groupError) return { error: groupError.message };

  revalidatePath("/inventory/categories");
  return { error: null };
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
  const { data: document } = await admin
    .from<{
      id: string;
      account_id: string;
      external_id: string;
      assigned_to: string | null;
      processed: boolean;
      base_last_update_date: string | null;
    }>("inventory_documents")
    .select("id, account_id, external_id, assigned_to, processed, base_last_update_date")
    .eq("id", input.documentId)
    .eq("account_id", ctx.accountId)
    .maybeSingle();

  if (!document?.id) return { resultsHasLineAmounts: false, error: "Акт не найден" };
  const allowed = Boolean(canManage) || (Boolean(canFill) && document.assigned_to === ctx.user.id);
  if (!allowed) return { resultsHasLineAmounts: false, error: "Недостаточно прав" };
  if (document.processed) return { resultsHasLineAmounts: false, error: "Акт уже проведен в Quick Resto" };

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
        .from("inventory_documents")
        .update({
          processed: Boolean(fresh.processed),
          base_last_update_date: dateText(fresh.lastUpdateDate),
          last_qr_update_date: dateText(fresh.lastUpdateDate),
          shortfall_sum: num(fresh.shortfallSum),
          surplus_sum: num(fresh.surplusSum),
          results_has_line_amounts: precheckHasResults,
          qr_payload: fresh,
          synced_at: new Date().toISOString(),
        })
        .eq("id", document.id)
        .eq("account_id", ctx.accountId);

      revalidatePath("/inventory/documents");
      revalidatePath(`/inventory/documents/${document.id}`);
      revalidatePath(`/inventory/documents/${document.id}/results`);
      return {
        resultsHasLineAmounts: false,
        refreshDocument: true,
        error: "Акт изменился в Quick Resto. Я обновил локальную версию; проверьте черновик и отправьте еще раз.",
      };
    }

    const localItemsResult = await admin
      .from<Array<{ id: string; external_item_id: string }>>("inventory_document_items")
      .select("id, external_item_id")
      .eq("document_id", document.id);
    const localItems = (localItemsResult.data ?? []) as Array<{ id: string; external_item_id: string }>;
    const externalByLocalId = new Map(localItems.map((item) => [item.id, item.external_item_id]));
    const nextAmounts = new Map<string, number>();
    for (const item of input.items) {
      const externalId = externalByLocalId.get(item.itemId);
      if (!externalId) continue;
      if (item.actualAmount === null || !Number.isFinite(item.actualAmount)) {
        return { resultsHasLineAmounts: false, error: "Проверьте фактические значения: есть некорректное число." };
      }
      nextAmounts.set(externalId, item.actualAmount);
    }
    if (nextAmounts.size === 0) {
      return { resultsHasLineAmounts: false, error: "Заполните хотя бы одну позицию акта" };
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

    let cookieHeader = await getBackOfficeCookie({ connection, admin });
    const sendBackOfficeRows = async (cookie: string) => {
      for (const row of updateRows) {
        await updateInventoryItemBackOffice({
          layerName: connection.login,
          baseUrl: connection.backoffice_base_url,
          cookieHeader: cookie,
          documentId: documentExternalId,
          item: row.item,
          actualAmount: row.actualAmount,
        });
      }
    };

    try {
      await sendBackOfficeRows(cookieHeader);
    } catch (error) {
      if (!isBackOfficeAuthError(error)) throw error;
      cookieHeader = await refreshBackOfficeCookie({ connection, admin });
      await sendBackOfficeRows(cookieHeader);
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
      .from<InventoryProductLookup[]>("inventory_products")
      .select("id, external_id, article, barcode")
      .eq("account_id", ctx.accountId);
    const productByExternalId = new Map(
      ((productRows.data ?? []) as InventoryProductLookup[]).map((row) => [String(row.external_id), row])
    );
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
      .from("inventory_documents")
      .update({
        status: nextStatus,
        processed: Boolean(reread.processed),
        base_last_update_date: dateText(reread.lastUpdateDate),
        last_qr_update_date: dateText(reread.lastUpdateDate),
        shortfall_sum: num(reread.shortfallSum),
        surplus_sum: num(reread.surplusSum),
        results_has_line_amounts: syncResult.resultsFound,
        qr_payload: rereadWithRows,
        submitted_at: new Date().toISOString(),
        submitted_by: ctx.user.id,
        synced_at: new Date().toISOString(),
      })
      .eq("id", document.id)
      .eq("account_id", ctx.accountId);

    if (updateLocalError) return { resultsHasLineAmounts: false, error: updateLocalError.message };

    revalidatePath("/inventory/documents");
    revalidatePath(`/inventory/documents/${document.id}`);
    revalidatePath(`/inventory/documents/${document.id}/results`);
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
    .from<{ id: string }>("inventory_products")
    .select("id")
    .eq("id", ingredientId)
    .eq("account_id", accountId)
    .maybeSingle();
  return Boolean(data?.id);
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
    .from("inventory_products")
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

  revalidatePath(`/inventory/products/${ingredientId}`);
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

  revalidatePath(`/inventory/products/${ingredientId}`);
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

  revalidatePath(`/inventory/products/${existing.ingredient_id}`);
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

  revalidatePath(`/inventory/products/${existing.ingredient_id}`);
  return { error: null };
}
