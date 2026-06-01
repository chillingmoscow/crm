// Внутренние хелперы и типы для server actions инвентаризации
// (вынесены из actions.ts). НЕ "use server" — обычный server-only модуль,
// который импортируют файлы экшенов.

import "server-only";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import { decryptSecret, encryptSecret } from "@/lib/integrations/crypto";
import { getInventoryResultAdjustLockReason } from "@/lib/inventory/act-status";
import {
  listInventoryItemsBackOffice,
  loginQuickRestoBackOffice,
  processInventoryDocumentBackOffice,
  type QuickRestoInventoryDocument2,
  type QuickRestoInventoryItem2,
  type QuickRestoSingleCategory,
  type QuickRestoSingleProduct,
  type QuickRestoStore,
} from "@/lib/integrations/quickresto/client";

export type QuickRestoConnection = {
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

export type InventorySyncSummary = {
  groups: number;
  products: number;
  stores: number;
  documents: number;
  items: number;
  resultsBlocked: number;
};

export type InventoryProductLookup = {
  id: string;
  external_id?: string;
  article?: string | null;
  barcode?: string | null;
};

export type InventoryStoreLookup = {
  id: string;
  external_id?: string | null;
};

export type InventoryExclusionRuleLookup = {
  id: string;
  ingredient_id: string | null;
  external_product_id: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

export type InventoryResultDocumentRow = {
  id: string;
  account_id: string;
  status: string;
  results_finalized_at: string | null;
  results_reopened_at: string | null;
  // Для маршрутизации уведомлений и авто-фоллбэка reviewer_id (PR-B).
  assigned_to: string | null;
  reviewer_id: string | null;
  document_number: string;
  venue_id: string | null;
  // QR-сторонний id (для backoffice-action /process). Хранится как текст
  // в БД, для QR API нужен number — конвертируем в caller'е.
  external_id: string | null;
};

// Замки статусной машины (isInventoryResultLocked / *AdjustLocked /
// isInventoryFormLocked) вынесены в @/lib/inventory/act-status — единый
// источник правды для server actions, формы и таблицы итогов.

export type InventoryResultItemRow = {
  id: string;
  document_id: string;
  account_id: string;
  ingredient_id: string | null;
  external_product_id: string | null;
  product_name: string;
  measure_unit_id: number | null;
  measure_unit_name: string | null;
  difference_amount: number | null;
  difference_sum: number | null;
  excluded_from_totals: boolean | null;
};

export type InventoryResultProductGroupRow = {
  id: string;
  group_id: string | null;
};

export type InventoryResultGroupRow = {
  id: string;
  name: string;
};

export const INVENTORY_DOCUMENT_ITEM_KEYS = [
  "effectedItems",
  "prefabricatedItems",
  "disassembledItems",
] as const;

export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Принимает число или строку из формы (в т.ч. с запятой-разделителем).
export function priceNum(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = value.trim().replace(",", ".");
    if (normalized === "") return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function className(value: unknown): string {
  return text(asObject(value).className) ?? "";
}

export function isQuickRestoClass(value: unknown, suffix: "SingleCategory" | "SingleProduct") {
  return className(value).endsWith(`.${suffix}`);
}

export function dateMs(value: unknown): number | null {
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

export function dateText(value: unknown): string | null {
  const parsed = dateMs(value);
  return parsed === null ? null : new Date(parsed).toISOString();
}

export function isDeletedQuickRestoRow(value: unknown) {
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

export function isRecentOpenInventoryDocument(doc: QuickRestoInventoryDocument2) {
  if (doc.processed || isDeletedQuickRestoRow(doc)) return false;
  const invoiceDate = dateText(doc.invoiceDate);
  if (!invoiceDate) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  cutoff.setHours(0, 0, 0, 0);
  return Date.parse(invoiceDate) >= cutoff.getTime();
}

export function sameDate(left: unknown, right: unknown) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  const leftMs = dateMs(left);
  const rightMs = dateMs(right);
  return leftMs !== null && rightMs !== null && leftMs === rightMs;
}

export function productName(product: QuickRestoSingleProduct | QuickRestoInventoryItem2["product"], fallback: string) {
  return text(product?.name) ?? text(product?.itemTitle) ?? fallback;
}

export function groupName(group: QuickRestoSingleCategory) {
  return text(group.name) ?? text(group.itemTitle) ?? `Группа #${group.id}`;
}

export function storeTitle(store: QuickRestoStore) {
  return text(store.title) ?? `Склад #${store.id}`;
}

export function inventoryDocumentNumber(doc: QuickRestoInventoryDocument2) {
  return text(doc.documentNumber) ?? `QR-${doc.id}`;
}

export function externalProductId(item: QuickRestoInventoryItem2): string | null {
  const raw = asObject(item.product);
  const id = raw.id;
  return typeof id === "number" || typeof id === "string" ? String(id) : null;
}

export function quickRestoObjectId(value: unknown): string | null {
  const row = asObject(value);
  const id = row.id;
  if (typeof id === "number" || typeof id === "string") return String(id);
  return null;
}

export function quickRestoParentExternalId(item: unknown): string | null {
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

export function externalItemId(item: QuickRestoInventoryItem2, index: number): string {
  if (typeof item.id === "number" || typeof item.id === "string") return String(item.id);
  const productId = externalProductId(item);
  return productId ? `product:${productId}` : `row:${index}`;
}

export function inventoryDocumentItems(document: QuickRestoInventoryDocument2) {
  for (const key of INVENTORY_DOCUMENT_ITEM_KEYS) {
    const value = document[key];
    if (Array.isArray(value) && value.length > 0) {
      return { key, items: value as QuickRestoInventoryItem2[] };
    }
  }
  return { key: "effectedItems" as const, items: [] as QuickRestoInventoryItem2[] };
}

export function getNestedNumber(item: QuickRestoInventoryItem2, keys: string[]) {
  const row = asObject(item);
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function extractLineResult(item: QuickRestoInventoryItem2) {
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

export function buildStoragePath(accountId: string, originalName: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const uuid = crypto.randomUUID();
  const safe = originalName.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";
  return `${accountId}/${yyyy}/${mm}/${uuid}-${safe}`;
}

export function actionErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export async function getActiveContext(permission?: string) {
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

/**
 * Резолвит venue для привязки QR-импортированных сущностей (stores,
 * documents и т.д.). Приоритет:
 *
 * 1. **Venue, смапленное на QuickResto через external_entity_links**
 *    (то самое, которое onboarding импортирует из QR TableScheme).
 *    Это правильный target — все QR-данные должны привязываться к
 *    QR-venue, не к manually-created venue в том же аккаунте.
 *    Старое поведение «активный venue из profile» приводило к багу:
 *    user заходит, активным был манально созданный CHILLING MOSCOW,
 *    QR-sync лип данные к нему вместо QR-importированного CHILLING.
 *
 * 2. **Fallback:** если QR-маппинга нет (странный кейс — onboarding
 *    не отрабатывал на venues), используем активный venue. Это
 *    защита от регресса в редких сценариях; в норме сюда не доходим.
 *
 * 3. **Final fallback:** если venue в аккаунте ровно одно — оно.
 */
export async function resolveDefaultVenueId(input: {
  admin: LooseDb;
  accountId: string;
  activeVenueId: string | null;
}) {
  // 1. QR-импортированное venue (priority — основной кейс).
  // В норме строка одна на (account, provider='quickresto', entity_type='venue').
  // Codex P1 #378: нет FK external_entity_links.local_id → venues.id,
  // поэтому возможен orphan (venue hard-удалён, link остался) или
  // ссылка на архивный venue. Перед использованием проверяем что
  // venue физически существует и live — иначе fallback ниже.
  // Multi-cloud (issue #362) пока не реализован.
  const { data: qrVenueLinks } = await input.admin
    .from<Array<{ local_id: string }>>("external_entity_links")
    .select("local_id")
    .eq("account_id", input.accountId)
    .eq("provider", "quickresto")
    .eq("entity_type", "venue");
  const qrVenueId = qrVenueLinks?.[0]?.local_id;
  if (qrVenueId) {
    const { data: qrVenue } = await input.admin
      .from<{ id: string; archived_at: string | null }>("venues")
      .select("id, archived_at")
      .eq("id", qrVenueId)
      .eq("account_id", input.accountId)
      .maybeSingle();
    if (qrVenue?.id && !qrVenue.archived_at) return qrVenue.id;
    // orphan / archived — пропускаем, идём на fallback
  }

  // 2. Fallback: активный venue (legacy-поведение, защита от регресса)
  if (input.activeVenueId) {
    const { data: activeVenue } = await input.admin
      .from<{ id: string }>("venues")
      .select("id")
      .eq("id", input.activeVenueId)
      .eq("account_id", input.accountId)
      .maybeSingle();
    if (activeVenue?.id) return activeVenue.id;
  }

  // 3. Final fallback: единственное venue в аккаунте
  const { data: venues } = await input.admin
    .from<Array<{ id: string }>>("venues")
    .select("id")
    .eq("account_id", input.accountId);
  return venues?.length === 1 ? venues[0].id : null;
}

export async function getConnection(accountId: string): Promise<QuickRestoConnection | null> {
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

export function connectionPassword(connection: QuickRestoConnection) {
  return decryptSecret({
    encrypted: connection.password_encrypted,
    iv: connection.password_iv,
    tag: connection.password_tag,
  });
}

export function decryptNullableSecret(payload: {
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

export function hasBackOfficePassword(connection: QuickRestoConnection) {
  return Boolean(
    connection.backoffice_login?.trim() &&
      connection.backoffice_password_encrypted &&
      connection.backoffice_password_iv &&
      connection.backoffice_password_tag
  );
}

export function isBackOfficeAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Quick Resto back-office auth failed") ||
    message.includes("Неверный логин или пароль back-office")
  );
}

export async function refreshBackOfficeCookie(input: {
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

export async function getBackOfficeCookie(input: {
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

export async function listBackOfficeInventoryItemsWithSession(input: {
  connection: QuickRestoConnection;
  admin: LooseDb;
  documentExternalId: number;
}) {
  let cookieHeader = await getBackOfficeCookie({
    connection: input.connection,
    admin: input.admin,
  });

  // pageSize=500 — обходим возможный bug пагинации backoffice
  // (на проде CB303 = 0 items, при том что в QR backoffice 34 позиции;
  // вероятная гипотеза — первая страница вернула пусто но total>0,
  // и loop сразу exit'нул). Большой pageSize читает всё одним батчем.
  const readRows = (cookie: string) =>
    listInventoryItemsBackOffice({
      layerName: input.connection.login,
      baseUrl: input.connection.backoffice_base_url,
      cookieHeader: cookie,
      documentId: input.documentExternalId,
      count: 500,
    });

  // На проде наблюдали: для одного из 10 актов backoffice items endpoint
  // не вернул calculated/difference (вероятно временная network/timeout
  // ошибка). Добавлен 1 ретрай через 500ms для не-auth ошибок —
  // отсекает транзиентные сбои, auth-error retry с refresh-cookie
  // оставлен отдельной веткой.
  try {
    return await readRows(cookieHeader);
  } catch (error) {
    if (isBackOfficeAuthError(error)) {
      cookieHeader = await refreshBackOfficeCookie({
        connection: input.connection,
        admin: input.admin,
      });
      return readRows(cookieHeader);
    }
    // Транзиентная ошибка — ретрай раз через 500мс с тем же cookie.
    await new Promise((resolve) => setTimeout(resolve, 500));
    return readRows(cookieHeader);
  }
}

/**
 * Провести акт инвентаризации в Quick Resto (выставить processed=true и
 * двинуть остатки). Использует backoffice-action /warehouse.inventory.document.v2/action
 * (тот же, что нажимает юзер в QR backoffice). На 401/403 — рефреш cookie и retry.
 *
 * Бросает Error при сетевой ошибке / отказе QR. Caller ловит и не меняет
 * локальное состояние (QR — источник правды для status=processed).
 */
export async function processBackOfficeInventoryDocumentWithSession(input: {
  connection: QuickRestoConnection;
  admin: LooseDb;
  documentExternalId: number;
}) {
  let cookieHeader = await getBackOfficeCookie({
    connection: input.connection,
    admin: input.admin,
  });

  const call = (cookie: string) =>
    processInventoryDocumentBackOffice({
      layerName: input.connection.login,
      baseUrl: input.connection.backoffice_base_url,
      cookieHeader: cookie,
      documentId: input.documentExternalId,
    });

  try {
    return await call(cookieHeader);
  } catch (error) {
    if (isBackOfficeAuthError(error)) {
      cookieHeader = await refreshBackOfficeCookie({
        connection: input.connection,
        admin: input.admin,
      });
      return call(cookieHeader);
    }
    throw error;
  }
}

export async function upsertExternalLink(input: {
  admin: LooseDb;
  accountId: string;
  entityType: string;
  externalId: string;
  localTable: string;
  localId: string;
}) {
  await input.admin.from("external_entity_links").upsert(
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

export async function saveSnapshot(input: {
  admin: LooseDb;
  accountId: string;
  entityType: string;
  externalId: string;
  payload: unknown;
}) {
  await input.admin.from("integration_external_snapshots").upsert(
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

export async function syncDocumentItems(input: {
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
    .select("id, ingredient_id, external_product_id, reason, created_by, created_at")
    .eq("account_id", input.accountId)
    .eq("status", "active");
  const exclusionRuleByProductId = new Map(
    (exclusionRulesRaw ?? [])
      .filter((rule) => rule.ingredient_id)
      .map((rule) => [rule.ingredient_id as string, rule]),
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
      ingredient_id: localProduct?.id ?? null,
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
      .from("document_items")
      .upsert(rows, { onConflict: "document_id,external_item_id" });
    if (error) throw new Error(error.message);

    const keepExternalIds = new Set(rows.map((row) => row.external_item_id));
    const { data: existingRows } = await input.admin
      .from<Array<{ external_item_id: string }>>("document_items")
      .select("external_item_id")
      .eq("document_id", input.documentId);
    const staleExternalIds = (existingRows ?? [])
      .map((row) => row.external_item_id)
      .filter((externalId) => !keepExternalIds.has(externalId));
    if (staleExternalIds.length > 0) {
      await input.admin
        .from("document_items")
        .delete()
        .eq("document_id", input.documentId)
        .in("external_item_id", staleExternalIds);
    }
  } else {
    await input.admin.from("document_items").delete().eq("document_id", input.documentId);
  }

  return { count: rows.length, resultsFound };
}

export async function refreshLocalInventoryDocumentFromPayload(input: {
  admin: LooseDb;
  accountId: string;
  documentId: string;
  document: QuickRestoInventoryDocument2;
  status?: string;
  submittedAmounts?: Map<string, number | null>;
}) {
  const itemsPreview = inventoryDocumentItems(input.document);
  const productRows = await input.admin
    .from<InventoryProductLookup[]>("ingredients")
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
    .from("documents")
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

export function amountsEqual(left: number | null | undefined, right: number | null | undefined) {
  if (left === null || left === undefined || right === null || right === undefined) {
    return left === right;
  }
  return Math.abs(left - right) < 0.000001;
}

export function readActualAmountsByExternalItemId(items: QuickRestoInventoryItem2[]) {
  const amounts = new Map<string, number | null>();
  items.forEach((item, index) => {
    amounts.set(externalItemId(item, index), num(item.actualAmount));
  });
  return amounts;
}

export function normalizeReason(value: string | null | undefined, fallback = "Укажите причину") {
  const reason = text(value);
  if (!reason) throw new Error(fallback);
  return reason;
}

export function resultItemMeasureKey(item: InventoryResultItemRow) {
  if (typeof item.measure_unit_id === "number") return `id:${item.measure_unit_id}`;
  return `name:${item.measure_unit_name ?? ""}`;
}

export async function getResultDocumentForAction(input: {
  admin: LooseDb;
  accountId: string;
  documentId: string;
  requireOpen?: boolean;
}) {
  const { data: document } = await input.admin
    .from<InventoryResultDocumentRow>("documents")
    .select(
      "id, account_id, status, results_finalized_at, results_reopened_at, assigned_to, reviewer_id, document_number, venue_id, external_id",
    )
    .eq("id", input.documentId)
    .eq("account_id", input.accountId)
    .maybeSingle();

  if (!document?.id) throw new Error("Акт не найден");
  if (input.requireOpen) {
    // Инструменты ревьюера закрыты при пересчёте (анти-подгонка) /
    // финализации / проведении — единый источник предиката и текста.
    const lockReason = getInventoryResultAdjustLockReason(document);
    if (lockReason) throw new Error(lockReason);
  }
  return document;
}

export async function writeInventoryResultEvent(input: {
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

export async function getActiveResortItemIds(input: {
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

export async function loadResultItemsForAdjustment(input: {
  admin: LooseDb;
  accountId: string;
  documentId: string;
  itemIds: string[];
}) {
  const uniqueItemIds = Array.from(new Set(input.itemIds));
  const { data: items } = await input.admin
    .from<InventoryResultItemRow[]>("document_items")
    .select(
      "id, document_id, account_id, ingredient_id, external_product_id, product_name, measure_unit_id, measure_unit_name, difference_amount, difference_sum, excluded_from_totals"
    )
    .eq("account_id", input.accountId)
    .eq("document_id", input.documentId)
    .in("id", uniqueItemIds);
  const rows = (items ?? []) as InventoryResultItemRow[];
  if (rows.length !== uniqueItemIds.length) throw new Error("Одна или несколько строк акта не найдены");
  return rows;
}

export async function resolveResultItemGroup(input: {
  admin: LooseDb;
  accountId: string;
  items: InventoryResultItemRow[];
}) {
  const productIds = input.items
    .map((item) => item.ingredient_id)
    .filter((id): id is string => Boolean(id));
  if (productIds.length === 0) throw new Error("Для пересорта нужны позиции, связанные с ингредиентами");

  const { data: products } = await input.admin
    .from<InventoryResultProductGroupRow[]>("ingredients")
    .select("id, group_id")
    .eq("account_id", input.accountId)
    .in("id", productIds);
  const groupByProductId = new Map((products ?? []).map((product) => [product.id, product.group_id]));
  const groupIds = new Set(
    input.items.map((item) => item.ingredient_id ? groupByProductId.get(item.ingredient_id) ?? null : null)
  );
  if (groupIds.size !== 1) throw new Error("Для пересорта можно выбрать позиции только одной группы");
  const groupId = Array.from(groupIds)[0];
  if (!groupId) throw new Error("Для пересорта нужны позиции с группой ингредиентов");

  const { data: group } = await input.admin
    .from<InventoryResultGroupRow>("ingredient_groups")
    .select("id, name")
    .eq("id", groupId)
    .eq("account_id", input.accountId)
    .maybeSingle();
  if (!group?.id) throw new Error("Группа выбранных позиций не найдена");
  return group;
}

export function revalidateInventoryResultPages(documentId: string) {
  revalidatePath("/documents/inventory");
  revalidatePath(`/documents/inventory/${documentId}`);
  revalidatePath(`/documents/inventory/${documentId}/results`);
}
