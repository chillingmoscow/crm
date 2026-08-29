// Внутренние хелперы и типы для server actions инвентаризации
// (вынесены из actions.ts). НЕ "use server" — обычный server-only модуль,
// который импортируют файлы экшенов.

import "server-only";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import { calculateResortAllocation } from "@/lib/inventory/results";
import { decryptSecret, encryptSecret } from "@/lib/integrations/crypto";
import {
  getInventoryResultAdjustLockReason,
  hasCountedResults,
  resolveStatusAfterImport,
} from "@/lib/inventory/act-status";
import { resolveExclusionState } from "@/lib/inventory/exclusions";
import { resolveLineResult, resolveSubmittedAmount } from "@/lib/inventory/sync-amounts";
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
  /** Акты, которые не удалось обработать: один сбойный акт не роняет проход. */
  failedDocuments: number;
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
  // Системный авто-архив: акт удалён в Quick Resto (миграция 216). Любое
  // действие над таким актом запрещаем — см. getResultDocumentForAction.
  archived_at: string | null;
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

/**
 * Статусы пересорта. Значения зафиксированы CHECK-констрейнтом
 * `check (status in ('active','voided'))` (миграция 177) — держим их одной
 * константой, чтобы три пути аннулирования (ручной экшен, авто-пересчёт,
 * триггер БД) не разъезжались в литерале.
 */
export const RESORT_STATUS = {
  active: "active",
  voided: "voided",
} as const;

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

export async function getActiveContext(permission?: string | string[]) {
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

  // Массив = требуются ВСЕ права (AND). Используется для итог-экшенов, где база —
  // inventory.view_results (менять итоги нельзя, если их не видишь), плюс
  // специфичное право (adjust/finalize/recount/comment). См. аудит прав F2/F3.
  if (permission) {
    const codes = Array.isArray(permission) ? permission : [permission];
    for (const code of codes) {
      const { data: allowed } = await supabase.rpc("has_permission", { permission_code: code });
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
    message.includes("Неверный логин или пароль back-office") ||
    // Spring Security remember-me ротирует токен на каждый запрос; если юзер
    // параллельно ходил в QR backoffice браузером, наша сохранённая cookie
    // становится «старой» и QR кидает 500 + CookieTheftException, инвалидируя
    // всю серию. Лечится тем же путём: re-login (refreshBackOfficeCookie)
    // создаёт новую серию → ретрай action'а проходит. Не реагируем на
    // подстроку только в одном направлении — матчим несколько признаков.
    message.includes("CookieTheftException") ||
    message.includes("remember-me token") ||
    /Invalid remember-me token \(Series\/token\) mismatch/i.test(message)
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


/** Пауза перед единственным повтором транзиентной ошибки backoffice. */
const TRANSIENT_RETRY_DELAY_MS = 500;

/**
 * Выполнить backoffice-операцию под сессией sheerly-bot с одним ретраем.
 *
 * Единственная точка ретрая для всего модуля: cookie протухает, Spring
 * ротирует remember-me — на auth-ошибке логинимся заново и повторяем ровно
 * один раз. Раньше этот же паттерн был написан четырьмя копиями (здесь, в
 * чтении позиций, в проведении акта и инлайном в отправке акта), и копии уже
 * разошлись поведением.
 *
 * `retryTransient` — дополнительный один ретрай НЕ-auth ошибки через паузу.
 * Нужен чтению позиций: на проде backoffice периодически отдаёт по акту пустой
 * ответ или обрывает соединение, и повтор помогает.
 */
export async function withBackOfficeSession<T>(input: {
  connection: QuickRestoConnection;
  admin: LooseDb;
  run: (cookieHeader: string) => Promise<T>;
  retryTransient?: boolean;
}): Promise<T> {
  const cookieHeader = await getBackOfficeCookie({
    connection: input.connection,
    admin: input.admin,
  });
  try {
    return await input.run(cookieHeader);
  } catch (error) {
    if (isBackOfficeAuthError(error)) {
      const fresh = await refreshBackOfficeCookie({
        connection: input.connection,
        admin: input.admin,
      });
      return input.run(fresh);
    }
    if (!input.retryTransient) throw error;
    await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS));
    return input.run(cookieHeader);
  }
}

export async function listBackOfficeInventoryItemsWithSession(input: {
  connection: QuickRestoConnection;
  admin: LooseDb;
  documentExternalId: number;
}) {
  // pageSize=500 — обходим возможный bug пагинации backoffice
  // (на проде CB303 = 0 items, при том что в QR backoffice 34 позиции;
  // вероятная гипотеза — первая страница вернула пусто но total>0,
  // и loop сразу exit'нул). Большой pageSize читает всё одним батчем.
  //
  // retryTransient: на проде для одного из 10 актов endpoint не вернул
  // calculated/difference (похоже на сетевой таймаут) — один повтор это
  // отсекает.
  return withBackOfficeSession({
    connection: input.connection,
    admin: input.admin,
    retryTransient: true,
    run: (cookieHeader) =>
      listInventoryItemsBackOffice({
        layerName: input.connection.login,
        baseUrl: input.connection.backoffice_base_url,
        cookieHeader,
        documentId: input.documentExternalId,
        count: 500,
      }),
  });
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
  // Match Make-схему: /action требует И backoffice session cookie, И
  // Authorization: Basic с API-creds (connection.login + password_*).
  // На 401 — cookie протухла → wrapper рефрешит и ретраит.
  const basicAuthLogin = input.connection.login.trim();
  const basicAuthPassword = decryptSecret({
    encrypted: input.connection.password_encrypted,
    iv: input.connection.password_iv,
    tag: input.connection.password_tag,
  });
  if (!basicAuthLogin || !basicAuthPassword) {
    throw new Error(
      "Не настроены API-учётные данные Quick Resto (нужны для Basic Auth на /action).",
    );
  }

  return withBackOfficeSession({
    connection: input.connection,
    admin: input.admin,
    run: (cookieHeader) =>
      processInventoryDocumentBackOffice({
        layerName: input.connection.login,
        baseUrl: input.connection.backoffice_base_url,
        cookieHeader,
        basicAuthLogin,
        basicAuthPassword,
        documentId: input.documentExternalId,
      }),
  });
}

/**
 * Размер пачки для батч-записи каталога.
 *
 * Синхронизация писала по строке за запрос: на каталоге в 3000 ингредиентов это
 * 9000 round-trip'ов (сам ингредиент + ссылка + снимок), то есть минуты работы
 * и столько же занятых соединений пула. Пишем пачками; размер выбран с оглядкой
 * на то, что в каждой строке лежит raw_payload — целый JSON позиции из Quick
 * Resto, и слать их десятками тысяч одним запросом не стоит.
 */
const CATALOG_BATCH_SIZE = 200;

/** Разрезать массив на пачки по CATALOG_BATCH_SIZE. */
export function catalogChunks<T>(rows: T[], size = CATALOG_BATCH_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

/** Батч-версия upsertExternalLink: одна запись на пачку вместо одной на строку. */
export async function upsertExternalLinks(input: {
  admin: LooseDb;
  accountId: string;
  entityType: string;
  localTable: string;
  rows: Array<{ externalId: string; localId: string }>;
}) {
  for (const chunk of catalogChunks(input.rows)) {
    const { error } = await input.admin.from("external_entity_links").upsert(
      chunk.map((row) => ({
        account_id: input.accountId,
        provider: "quickresto",
        entity_type: input.entityType,
        external_id: row.externalId,
        local_table: input.localTable,
        local_id: row.localId,
      })),
      { onConflict: "account_id,provider,entity_type,external_id" },
    );
    if (error) throw new Error(error.message);
  }
}

/** Батч-версия saveSnapshot. */
export async function saveSnapshots(input: {
  admin: LooseDb;
  accountId: string;
  entityType: string;
  rows: Array<{ externalId: string; payload: unknown }>;
}) {
  const fetchedAt = new Date().toISOString();
  for (const chunk of catalogChunks(input.rows)) {
    const { error } = await input.admin.from("integration_external_snapshots").upsert(
      chunk.map((row) => ({
        account_id: input.accountId,
        provider: "quickresto",
        entity_type: input.entityType,
        external_id: row.externalId,
        payload: row.payload,
        fetched_at: fetchedAt,
      })),
      { onConflict: "account_id,provider,entity_type,external_id" },
    );
    if (error) throw new Error(error.message);
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


/**
 * Пересчёт активных пересортов после импорта строк из Quick Resto.
 *
 * `inventory_result_resort_items` хранит суммы, посчитанные в МОМЕНТ создания
 * пересорта (source_* и remaining_*), а управленческий итог берёт именно их
 * (calculateManagementTotals). Импорт же перезаписывает difference_* по
 * строкам — и пересорт продолжал зачитывать вчерашние объёмы: строка на экране
 * показывала недостачу, а в «К списанию» по ней стоял ноль.
 *
 * Поэтому после каждого импорта пересчитываем аллокацию по свежим значениям:
 *  - объёмы сошлись по-прежнему → обновляем суммы пересорта;
 *  - пересорт больше не складывается (одна из строк исчезла, или не осталось
 *    пары недостача+излишек) → аннулируем его и пишем в журнал, чтобы
 *    проверяющий увидел и пересобрал вручную.
 */
async function recalculateActiveResorts(input: {
  admin: LooseDb;
  accountId: string;
  documentId: string;
}): Promise<{ recalculated: number; voided: number }> {
  const { data: resortsRaw } = await input.admin
    .from<Array<{ id: string; group_id: string | null; measure_unit_key: string | null }>>(
      "inventory_result_resorts",
    )
    .select("id, group_id, measure_unit_key")
    .eq("account_id", input.accountId)
    .eq("document_id", input.documentId)
    .eq("status", RESORT_STATUS.active);
  const resorts = resortsRaw ?? [];
  if (resorts.length === 0) return { recalculated: 0, voided: 0 };

  const { data: resortItemsRaw } = await input.admin
    .from<
      Array<{
        id: string;
        resort_id: string;
        document_item_id: string;
        source_difference_amount: number | null;
        source_difference_sum: number | null;
      }>
    >("inventory_result_resort_items")
    .select("id, resort_id, document_item_id, source_difference_amount, source_difference_sum")
    .eq("account_id", input.accountId)
    .eq("document_id", input.documentId)
    .in(
      "resort_id",
      resorts.map((resort) => resort.id),
    );
  const resortItems = resortItemsRaw ?? [];

  const { data: currentItemsRaw } = await input.admin
    .from<Array<{ id: string; difference_amount: number | null; difference_sum: number | null }>>(
      "document_items",
    )
    .select("id, difference_amount, difference_sum")
    .eq("account_id", input.accountId)
    .eq("document_id", input.documentId);
  const currentById = new Map((currentItemsRaw ?? []).map((row) => [row.id, row]));

  let recalculated = 0;
  let voided = 0;

  const voidResort = async (resortId: string, reason: string) => {
    // Статус — только из RESORT_STATUS: раньше здесь стоял литерал "void",
    // которого нет в CHECK-констрейнте (миграция 177 разрешает 'active' и
    // 'voided'). UPDATE молча падал, пересорт оставался активным и продолжал
    // участвовать в управленческом итоге со старыми суммами — а в журнал при
    // этом уходила запись «Пересорт отменён». Ошибку теперь разбираем: без
    // успешного перехода ни события, ни счётчика.
    const { error } = await input.admin
      .from("inventory_result_resorts")
      .update({
        status: RESORT_STATUS.voided,
        void_reason: reason,
        voided_at: new Date().toISOString(),
      })
      .eq("id", resortId)
      .eq("account_id", input.accountId);
    if (error) {
      console.error("[recalculateActiveResorts] не удалось аннулировать пересорт", {
        resortId,
        documentId: input.documentId,
        error,
      });
      return;
    }
    await input.admin.from("inventory_result_events").insert({
      account_id: input.accountId,
      document_id: input.documentId,
      resort_id: resortId,
      event_type: "resort_voided",
      message: reason,
      payload: { auto: true },
      created_by: null,
    });
    voided += 1;
  };

  for (const resort of resorts) {
    const rows = resortItems.filter((row) => row.resort_id === resort.id);
    // Пересорт, потерявший позицию, аннулирует триггер БД
    // inventory_result_resort_items_orphan_guard (миграция 226) — прикладной
    // копии этой же проверки здесь больше нет: две реализации одного инварианта
    // ровно так и расходятся. Сюда доходят только пересорты, у которых пара
    // на месте, но свежие данные Quick Resto перестали складываться.
    const pairs = rows.map((row) => ({ row, current: currentById.get(row.document_item_id) ?? null }));
    if (rows.length < 2 || pairs.some((pair) => !pair.current)) continue;

    const changed = pairs.some(({ row, current }) => {
      const amountChanged =
        Math.abs((num(current?.difference_amount) ?? 0) - (row.source_difference_amount ?? 0)) > 0.000001;
      const sumChanged = Math.abs((num(current?.difference_sum) ?? 0) - (row.source_difference_sum ?? 0)) > 0.005;
      return amountChanged || sumChanged;
    });
    if (!changed) continue;

    try {
      const allocation = calculateResortAllocation(
        pairs.map(({ row, current }) => ({
          id: row.document_item_id,
          // Группа и единица уже проверены при создании пересорта: подставляем
          // общий ключ, чтобы валидация calculateResortAllocation прошла на
          // тех же самых строках.
          groupId: resort.group_id ?? "resort-group",
          measureUnitKey: resort.measure_unit_key ?? "resort-unit",
          differenceAmount: num(current?.difference_amount),
          differenceSum: num(current?.difference_sum),
        })),
      );

      const sourceShortfallSum = pairs
        .map(({ current }) => num(current?.difference_sum) ?? 0)
        .filter((value) => value < 0)
        .reduce((total, value) => total + value, 0);
      const sourceSurplusSum = pairs
        .map(({ current }) => num(current?.difference_sum) ?? 0)
        .filter((value) => value > 0)
        .reduce((total, value) => total + value, 0);

      await input.admin
        .from("inventory_result_resorts")
        .update({
          offset_amount: allocation.offsetAmount,
          residual_shortfall_sum: allocation.residualShortfallSum,
          residual_surplus_sum: allocation.residualSurplusSum,
          source_shortfall_sum: sourceShortfallSum,
          source_surplus_sum: sourceSurplusSum,
          cost_adjustment_sum: allocation.costAdjustmentSum,
        })
        .eq("id", resort.id)
        .eq("account_id", input.accountId);

      const rowByItemId = new Map(rows.map((row) => [row.document_item_id, row]));
      for (const allocationItem of allocation.items) {
        const row = rowByItemId.get(allocationItem.id);
        if (!row) continue;
        await input.admin
          .from("inventory_result_resort_items")
          .update({
            role: allocationItem.role,
            source_difference_amount: allocationItem.sourceDifferenceAmount,
            source_difference_sum: allocationItem.sourceDifferenceSum,
            offset_amount: allocationItem.offsetAmount,
            remaining_difference_amount: allocationItem.remainingDifferenceAmount,
            remaining_difference_sum: allocationItem.remainingDifferenceSum,
          })
          .eq("id", row.id)
          .eq("account_id", input.accountId);
      }

      await input.admin.from("inventory_result_events").insert({
        account_id: input.accountId,
        document_id: input.documentId,
        resort_id: resort.id,
        event_type: "resort_recalculated",
        message: "Пересорт пересчитан: данные Quick Resto изменились",
        payload: {
          auto: true,
          offsetAmount: allocation.offsetAmount,
          costAdjustmentSum: allocation.costAdjustmentSum,
        },
        created_by: null,
      });
      recalculated += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "пересорт больше не складывается";
      await voidResort(resort.id, `Пересорт отменён: ${message}`);
    }
  }

  if (recalculated > 0 || voided > 0) {
    console.info(
      `[recalculateActiveResorts] doc ${input.documentId}: пересчитано ${recalculated}, аннулировано ${voided}`,
    );
  }
  return { recalculated, voided };
}

/**
 * Порог «ответ Quick Resto выглядит обрезанным»: столько строк должно
 * пропасть, чтобы мы заподозрили сбой выгрузки, а не решение человека.
 * Работает вместе с условием «больше половины акта» (см. syncDocumentItems).
 */
const STALE_DELETE_MIN_ROWS = 5;

export async function syncDocumentItems(input: {
  admin: LooseDb;
  accountId: string;
  documentId: string;
  items: QuickRestoInventoryItem2[];
  productByExternalId: Map<string, InventoryProductLookup>;
  submittedAmounts?: Map<string, number | null>;
}) {
  let resultsFound = false;
  let preservedResultLines = 0;
  let skippedStaleDeletion = 0;
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

  // Существующее состояние строк акта. Нужно по трём причинам:
  // 1) сохранить РУЧНЫЕ исключения (excluded_from_totals без exclusion-rule),
  //    чтобы sync их не сбрасывал;
  // 2) НЕ слать NULL в excluded_from_totals. supabase-js upsert при разнородном
  //    батче (одни строки задают колонку, другие — нет) подставляет остальным
  //    NULL, а не DEFAULT → NOT NULL violation в актах с исключёнными позициями.
  //    Поэтому 4 поля исключения задаём явно на КАЖДОЙ строке.
  // 3) сохранить введённые исполнителем количества (submitted_amount) для строк,
  //    которых нет в `submittedAmounts` текущего вызова. Раньше им писался NULL,
  //    и «Обновить итоги из Quick Resto» (вызывает нас без submittedAmounts)
  //    стирал введённые количества по всему акту — прод, СВ340, 300 строк.
  const { data: existingItemRows } = await input.admin
    .from<
      Array<{
        id: string;
        external_item_id: string;
        submitted_amount: number | null;
        calculated_amount: number | null;
        difference_amount: number | null;
        prime_cost: number | null;
        difference_sum: number | null;
        excluded_from_totals: boolean | null;
        exclude_reason: string | null;
        excluded_by: string | null;
        excluded_at: string | null;
        exclusion_rule_id: string | null;
        exclusion_rule_dismissed_at: string | null;
      }>
    >("document_items")
    .select(
      "id, external_item_id, submitted_amount, calculated_amount, difference_amount, prime_cost, difference_sum, excluded_from_totals, exclude_reason, excluded_by, excluded_at, exclusion_rule_id, exclusion_rule_dismissed_at",
    )
    .eq("document_id", input.documentId);
  const existingItemByItemId = new Map(
    (existingItemRows ?? []).map((row) => [row.external_item_id, row]),
  );

  // Строки в активном пересорте импорт не трогает правилами автоисключения.
  // Ручные пути такой гард имеют (actions.ts: «Строку в активном пересорте
  // нельзя исключить»), импорт — нет: правило, заведённое в другом акте,
  // выбивало строку из итогов, при этом корректировка себестоимости пересорта
  // продолжала вычитаться, и остаток недостачи просто пропадал.
  const activeResortItemIds = await getActiveResortItemIds({
    admin: input.admin,
    accountId: input.accountId,
    documentId: input.documentId,
  });

  const rows = input.items.map((item, index) => {
    const productId = externalProductId(item);
    const localProduct = productId ? input.productByExternalId.get(productId) : null;
    const exclusionRule =
      (localProduct?.id ? exclusionRuleByProductId.get(localProduct.id) : null) ??
      (productId ? exclusionRuleByExternalProductId.get(productId) : null);
    const product = item.product ?? {};
    const result = extractLineResult(item);
    const itemExternalId = externalItemId(item, index);

    // Поля исключения — явно на каждой строке (см. existingItemByItemId).
    // Правило (если есть) приоритетнее; иначе сохраняем ручное исключение;
    // иначе дефолт (не исключено).
    const existingItem = existingItemByItemId.get(itemExternalId);
    const inActiveResort = existingItem ? activeResortItemIds.has(existingItem.id) : false;
    // Пустой ответ QR не должен затирать уже посчитанные итоги (см.
    // resolveLineResult): backoffice периодически отваливается, и импорт
    // сваливается на public-payload без расчётных полей.
    const lineResult = resolveLineResult({
      incoming: result,
      existing: existingItem
        ? {
            calculatedAmount: existingItem.calculated_amount,
            differenceAmount: existingItem.difference_amount,
            primeCost: existingItem.prime_cost,
            differenceSum: existingItem.difference_sum,
          }
        : null,
    });
    if (result.hasResult || lineResult.preserved) resultsFound = true;
    if (lineResult.preserved) preservedResultLines += 1;
    // Правило автоисключения применяем, только если проверяющий не отменил его
    // в этом акте (см. resolveExclusionState). Раньше правило перебивало ручное
    // «Учитывать в этом акте» на ближайшем же импорте — молча, без записи в
    // журнале.
    const exclusion = resolveExclusionState({
      rule: exclusionRule
        ? {
            id: exclusionRule.id,
            reason: exclusionRule.reason,
            created_by: exclusionRule.created_by,
            created_at: exclusionRule.created_at,
          }
        : null,
      inActiveResort,
      existing: existingItem ?? null,
    });

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
      submitted_amount: resolveSubmittedAmount({
        externalItemId: itemExternalId,
        submittedAmounts: input.submittedAmounts,
        existingAmount: existingItem?.submitted_amount ?? null,
      }),
      calculated_amount: lineResult.values.calculatedAmount,
      difference_amount: lineResult.values.differenceAmount,
      prime_cost: lineResult.values.primeCost,
      difference_sum: lineResult.values.differenceSum,
      sort_order: index,
      raw_payload: item,
      // result_payload — диагностический сырец последнего ответа QR (NOT NULL
      // default '{}'). Держим его строго по факту ответа: undefined в
      // разнородном upsert-батче supabase-js превращается в NULL → падение.
      result_payload: result.hasResult ? item : {},
      ...exclusion,
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
    const existingCount = (existingRows ?? []).length;
    const staleExternalIds = (existingRows ?? [])
      .map((row) => row.external_item_id)
      .filter((externalId) => !keepExternalIds.has(externalId));
    // Защита от ЧАСТИЧНОГО ответа Quick Resto. От полностью пустого мы уже
    // защищены (ветка else ниже), но backoffice умеет отдавать и обрезанную
    // страницу — тогда «пропавшие» строки удалялись бы вместе со снимком
    // итогов (finalized_*) и половинами пересортов, каскадом и безвозвратно.
    // Разовое удаление пары позиций — нормальная работа; исчезновение больше
    // половины акта — почти наверняка сбой выгрузки, а не решение человека.
    const looksTruncated =
      staleExternalIds.length >= STALE_DELETE_MIN_ROWS &&
      staleExternalIds.length > existingCount / 2;
    if (looksTruncated) {
      console.warn(
        `[syncDocumentItems] doc ${input.documentId}: Quick Resto не вернул ${staleExternalIds.length} из ${existingCount} строк — удаление пропущено, строки сохранены`,
      );
      skippedStaleDeletion = staleExternalIds.length;
    } else if (staleExternalIds.length > 0) {
      await input.admin
        .from("document_items")
        .delete()
        .eq("document_id", input.documentId)
        .in("external_item_id", staleExternalIds);
    }
  } else {
    // Пустой ответ Quick Resto — НЕ повод удалять акт по строкам. Backoffice
    // на проде умеет отдавать 0 позиций по живому акту (акт CB303, см.
    // диагностику в syncQuickRestoInventory), а public-payload у проведённого
    // акта тоже бывает без items. Раньше здесь стоял безусловный DELETE: один
    // клик «Обновить итоги» в такой момент сносил введённые количества,
    // комментарии, исключения и каскадом — позиции пересортов.
    // Удаляем только если строк не было и раньше (нечего терять).
    const { data: existingRows } = await input.admin
      .from<Array<{ id: string }>>("document_items")
      .select("id")
      .eq("document_id", input.documentId);
    const existingCount = (existingRows ?? []).length;
    if (existingCount > 0) {
      console.warn(
        `[syncDocumentItems] doc ${input.documentId}: Quick Resto вернул 0 позиций, в базе ${existingCount} — строки сохранены, импорт пропущен`,
      );
      return {
        count: 0,
        resultsFound: false,
        skippedEmptyPayload: true,
        preservedResultLines: 0,
        skippedStaleDeletion: 0,
      };
    }
  }

  // Пересорты считались по старым difference_* — приводим их к свежим данным.
  // Сбой пересчёта не должен ронять импорт: строки уже сохранены, а пересорт
  // в худшем случае останется со старыми суммами (как было до этой правки).
  try {
    await recalculateActiveResorts({
      admin: input.admin,
      accountId: input.accountId,
      documentId: input.documentId,
    });
  } catch (error) {
    console.error(`[syncDocumentItems] пересчёт пересортов не удался (doc ${input.documentId}):`, error);
  }

  if (preservedResultLines > 0) {
    console.warn(
      `[syncDocumentItems] doc ${input.documentId}: Quick Resto не прислал расчёты по ${preservedResultLines} строкам — оставили прежние значения`,
    );
  }

  return {
    count: rows.length,
    resultsFound,
    skippedEmptyPayload: false,
    preservedResultLines,
    skippedStaleDeletion,
  };
}

/**
 * Суммы акта из Quick Resto для записи в documents (миграция 225).
 *
 * QR заполняет shortfallSum/surplusSum документа ТОЛЬКО у проведённого акта —
 * у непроведённого он отдаёт нули. Записать эти нули нельзя: карточка акта
 * показывает строку «Quick Resto при проведении: …» по наличию значения, и
 * нетронутый акт рисовал бы итог проводки, которой не было. Поэтому у
 * непроведённого акта явно пишем null (заодно снимая устаревшие значения,
 * если акт распровели).
 */
export function quickRestoDocumentSums(document: {
  processed?: boolean;
  shortfallSum?: number;
  surplusSum?: number;
}): { qr_shortfall_sum: number | null; qr_surplus_sum: number | null } {
  if (!document.processed) {
    return { qr_shortfall_sum: null, qr_surplus_sum: null };
  }
  return {
    qr_shortfall_sum: num(document.shortfallSum),
    qr_surplus_sum: num(document.surplusSum),
  };
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
  // Текущий статус нужен, чтобы импорт не двигал акт по статусной машине
  // (см. resolveStatusAfterImport): раньше он вышибал исполнителя из формы
  // посреди пересчёта.
  const { data: currentDoc } = await input.admin
    .from<{ status: string }>("documents")
    .select("status")
    .eq("id", input.documentId)
    .eq("account_id", input.accountId)
    .maybeSingle();
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
    resolveStatusAfterImport({
      current: currentDoc?.status ?? "synced",
      processed: Boolean(input.document.processed),
      resultsFound: syncResult.resultsFound,
    });

  if (syncResult.skippedEmptyPayload) {
    // Строки сохранены (см. syncDocumentItems), метаданные акта тоже не трогаем:
    // на пустом ответе QR нам нечем их уточнить, а results_has_line_amounts=false
    // спрятал бы уже посчитанные итоги.
    return syncResult;
  }

  const { error } = await input.admin
    .from("documents")
    .update({
      status,
      processed: Boolean(input.document.processed),
      base_last_update_date: dateText(input.document.lastUpdateDate),
      last_qr_update_date: dateText(input.document.lastUpdateDate),
      ...quickRestoDocumentSums(input.document),
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

/**
 * Виден ли акт пользователю — проверяем ЕГО клиентом, под RLS.
 *
 * Все мутации модуля идут под service_role (admin-клиент), который RLS
 * обходит: миграция 219 сознательно отозвала write-гранты у authenticated.
 * Значит, единственная граница доступа — проверка в самом экшене, а её не
 * было: зная uuid, менеджер одного заведения правил, возвращал на пересчёт и
 * проводил акты чужого заведения того же аккаунта.
 *
 * Проверку не дублируем предикатом в коде, а переиспользуем политику
 * documents_select (миграция 210): она уже описывает и активное заведение, и
 * исключения для исполнителя и проверяющего. Не видишь акт — не действуешь.
 */
export async function assertDocumentVisible(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  documentId: string;
}) {
  const { data } = await asLooseDb(input.supabase)
    .from<{ id: string }>("documents")
    .select("id")
    .eq("id", input.documentId)
    .maybeSingle();
  if (!data?.id) throw new Error("Акт не найден");
}

/**
 * Отфильтровать список актов до тех, что пользователь реально видит.
 * Массовый аналог assertDocumentVisible — одним запросом под RLS, чтобы
 * bulk-экшены не доверяли массиву id с клиента.
 */
export async function filterVisibleDocumentIds(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  documentIds: string[];
}): Promise<Set<string>> {
  if (input.documentIds.length === 0) return new Set();
  const { data } = await asLooseDb(input.supabase)
    .from<Array<{ id: string }>>("documents")
    .select("id")
    .in("id", input.documentIds);
  return new Set((data ?? []).map((row) => row.id));
}

/**
 * Подобрать активное правило автоисключения под позицию — тем же способом,
 * каким это делает импорт: сперва по ингредиенту, затем по внешнему id позиции.
 *
 * Нужен там, где решение принимает человек: «Учитывать в этом акте» обязано
 * отменить ДЕЙСТВУЮЩЕЕ правило, а не только то, что записано в строке. Ручное
 * исключение сбрасывает происхождение (за строку теперь отвечает человек),
 * поэтому по одному лишь exclusion_rule_id действующее правило не найти —
 * и импорт применил бы его заново.
 */
export async function loadActiveExclusionRuleMatcher(input: {
  admin: LooseDb;
  accountId: string;
}): Promise<(item: { ingredient_id: string | null; external_product_id: string | null }) => InventoryExclusionRuleLookup | null> {
  const { data } = await input.admin
    .from<InventoryExclusionRuleLookup[]>("inventory_result_exclusion_rules")
    .select("id, ingredient_id, external_product_id, reason, created_by, created_at")
    .eq("account_id", input.accountId)
    .eq("status", "active");
  const rules = data ?? [];
  const byIngredient = new Map(
    rules.filter((rule) => rule.ingredient_id).map((rule) => [rule.ingredient_id as string, rule]),
  );
  const byExternalId = new Map(
    rules
      .filter((rule) => !rule.ingredient_id && rule.external_product_id)
      .map((rule) => [rule.external_product_id as string, rule]),
  );
  return (item) =>
    (item.ingredient_id ? byIngredient.get(item.ingredient_id) ?? null : null) ??
    (item.external_product_id ? byExternalId.get(item.external_product_id) ?? null : null);
}

export async function getResultDocumentForAction(input: {
  admin: LooseDb;
  supabase: Awaited<ReturnType<typeof createClient>>;
  accountId: string;
  documentId: string;
  requireOpen?: boolean;
}) {
  await assertDocumentVisible({ supabase: input.supabase, documentId: input.documentId });
  const { data: document } = await input.admin
    .from<InventoryResultDocumentRow>("documents")
    .select(
      "id, account_id, status, results_finalized_at, results_reopened_at, assigned_to, reviewer_id, document_number, venue_id, external_id, archived_at",
    )
    .eq("id", input.documentId)
    .eq("account_id", input.accountId)
    .maybeSingle();

  if (!document?.id) throw new Error("Акт не найден");
  // Акт удалён в Quick Resto (авто-архив при синхронизации) — любые действия
  // запрещены. Закрывает доступ по закладке / из уже открытой страницы, минуя
  // скрытие из списка. Едина точка для всех result-экшенов.
  if (document.archived_at) {
    throw new Error("Этот акт удалён в Quick Resto и недоступен для изменений.");
  }
  if (input.requireOpen) {
    // До сдачи акта итогов не существует: разница из Quick Resto равна минус
    // складскому остатку, потому что факт ещё нулевой. Любые действия по итогам
    // (отметить на пересчёт, исключить, свести пересорт) в этот момент
    // бессмысленны — гейтим их так же, как страницу итогов.
    if (!hasCountedResults(document.status)) {
      throw new Error(
        "Подсчёт ещё не завершён — работать с итогами можно после того, как исполнитель сдаст акт.",
      );
    }
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

/**
 * Батч-запись событий журнала для массовых действий.
 *
 * writeInternalResultEvent на строку давал два round-trip'а на позицию (запись
 * в журнал + log_audit), то есть 600 запросов на акт в 300 позиций. Здесь
 * журнальные записи уходят одним insert'ом, а в аудит пишется ОДНА строка на всё
 * действие — он и так документного уровня (entity = inventory_document), и
 * триста одинаковых записей про один акт были чистым шумом.
 */
export async function writeInventoryResultEvents(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  admin: LooseDb;
  accountId: string;
  userId: string;
  documentId: string;
  eventType: string;
  events: Array<{ documentItemId?: string | null; resortId?: string | null; message: string; payload?: Record<string, unknown> }>;
  auditPayload?: Record<string, unknown>;
}) {
  if (input.events.length === 0) return;
  for (const chunk of catalogChunks(input.events)) {
    const { error } = await input.admin.from("inventory_result_events").insert(
      chunk.map((event) => ({
        account_id: input.accountId,
        document_id: input.documentId,
        document_item_id: event.documentItemId ?? null,
        resort_id: event.resortId ?? null,
        event_type: input.eventType,
        message: event.message,
        payload: event.payload ?? {},
        created_by: input.userId,
      })),
    );
    if (error) throw new Error(error.message);
  }
  await input.supabase.rpc("log_audit", {
    p_action_code: `inventory.${input.eventType}`,
    p_entity_type: "inventory_document",
    p_entity_id: input.documentId,
    p_details: (input.auditPayload ?? { bulk: true, count: input.events.length }) as never,
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
    .eq("status", RESORT_STATUS.active);
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

/**
 * Best-effort уведомление по событию акта инвентаризации. Зеркалит паттерн
 * assignInventoryDocument: ошибка не валит основной flow. Не шлёт самому
 * себе и при пустом получателе (например, reviewer_id ещё не задан).
 */
export async function notifyInventoryDocumentEvent(input: {
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
