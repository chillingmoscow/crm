export type QuickRestoTableScheme = {
  id: number;
  name?: string;
  itemTitle?: string;
  address?: { fullAddress?: string } | null;
  webHalls?: unknown[];
  tables?: unknown[];
  [key: string]: unknown;
};

export type QuickRestoRole = {
  id: number;
  title?: string;
  systemRole?: string;
  comment?: string;
  backOfficeUser?: boolean;
  frontOfficeUser?: boolean;
  courierUser?: boolean;
  rightLinks?: unknown[];
  [key: string]: unknown;
};

export type QuickRestoEmployeeListItem = {
  id: number;
  systemEmployee?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  fullName?: string;
  blocked?: boolean;
  dateOfBirth?: string;
  user?: { id?: number };
  allowedTablesSchemes?: Array<{ id?: number }>;
  [key: string]: unknown;
};

export type QuickRestoEmployeeRead = QuickRestoEmployeeListItem & {
  user?: {
    id?: number;
    login?: string;
    telegramId?: string;
    role?: {
      id?: number;
      title?: string;
      systemRole?: string;
    };
    [key: string]: unknown;
  };
};

export type QuickRestoMeasureUnit = {
  id?: number;
  version?: number;
  name?: string;
  fullName?: string;
  code?: string;
  systemUnit?: string;
  parentRatio?: number;
  [key: string]: unknown;
};

export type QuickRestoStoreItemTag = {
  id?: number;
  version?: number;
  name?: string;
  iconImage?: string;
  [key: string]: unknown;
};

export type QuickRestoSingleCategory = {
  id: number;
  name?: string;
  itemTitle?: string;
  parentId?: number;
  parentItem?: { id?: number; name?: string; itemTitle?: string; [key: string]: unknown } | null;
  serverRegisterTime?: string;
  [key: string]: unknown;
};

export type QuickRestoSingleProduct = {
  id: number;
  version?: number;
  name?: string;
  itemTitle?: string;
  article?: string;
  barCode?: string;
  code1C?: string;
  measureUnit?: QuickRestoMeasureUnit | null;
  ratio?: number;
  parentId?: number;
  parentItem?: { id?: number; name?: string; itemTitle?: string; [key: string]: unknown } | null;
  storeItemTags?: QuickRestoStoreItemTag[];
  currentPrimeCost?: number;
  storeQuantityKg?: number;
  limit?: number;
  serverRegisterTime?: string;
  [key: string]: unknown;
};

export type QuickRestoStoreItem = QuickRestoSingleCategory | QuickRestoSingleProduct;

export type QuickRestoStore = {
  id: number;
  title?: string;
  storeCode?: string;
  description?: string;
  liteBusiness?: { id?: number; title?: string; name?: string; [key: string]: unknown } | null;
  [key: string]: unknown;
};

export type QuickRestoInventoryProductRef = {
  id?: number;
  name?: string;
  itemTitle?: string;
  article?: string;
  barCode?: string;
  measureUnit?: QuickRestoMeasureUnit | null;
  [key: string]: unknown;
};

export type QuickRestoInventoryItem2 = {
  id?: number;
  product?: QuickRestoInventoryProductRef | null;
  measureUnit?: QuickRestoMeasureUnit | null;
  actualAmount?: number | null;
  vat?: unknown;
  [key: string]: unknown;
};

export type QuickRestoInventoryDocument2 = {
  id: number;
  documentNumber?: string;
  invoiceDate?: string | number;
  store?: QuickRestoStore | null;
  processed?: boolean;
  lastUpdateDate?: string | number;
  shortfallSum?: number;
  surplusSum?: number;
  comment?: string;
  prefabricatedItems?: QuickRestoInventoryItem2[];
  disassembledItems?: QuickRestoInventoryItem2[];
  effectedItems?: QuickRestoInventoryItem2[];
  [key: string]: unknown;
};

type QuickRestoBackOfficeSelectResponse<T> =
  | T[]
  | {
      data?: T[];
      ds?: Array<T | { object?: T; [key: string]: unknown }>;
      rows?: T[];
      items?: T[];
      list?: T[];
      result?: T[];
      total?: number;
      count?: number;
      totalCount?: number;
      [key: string]: unknown;
    };

const TABLE_SCHEME_CLASS =
  "ru.edgex.quickresto.modules.front.tablemanagement.TableScheme";
const TABLE_SCHEME_MODULE = "front.tablemanagement";

const ROLE_CLASS = "ru.edgex.platform.service.user.Role";
const ROLE_MODULE = "users.role";

const EMPLOYEE_CLASS =
  "ru.edgex.quickresto.modules.personnel.employee.Employee";
const EMPLOYEE_MODULE = "personnel.employee";

const SINGLE_PRODUCT_CLASS =
  "ru.edgex.quickresto.modules.warehouse.nomenclature.singleproduct.SingleProduct";
const SINGLE_CATEGORY_CLASS =
  "ru.edgex.quickresto.modules.warehouse.nomenclature.singleproduct.SingleCategory";
const SINGLE_PRODUCT_MODULE = "warehouse.nomenclature.singleproduct";

// Блюда и полуфабрикаты — отдельные модули номенклатуры (по аналогии с
// singleproduct). Класс-суффикс из raw_payload позиций акта: Dish / SemiProduct.
const DISH_CLASS = "ru.edgex.quickresto.modules.warehouse.nomenclature.dish.Dish";
const DISH_MODULE = "warehouse.nomenclature.dish";
const SEMIPRODUCT_CLASS =
  "ru.edgex.quickresto.modules.warehouse.nomenclature.semiproduct.SemiProduct";
const SEMIPRODUCT_MODULE = "warehouse.nomenclature.semiproduct";

// Классы категорий. Подтверждены пробой на живом подключении: плоский list по
// модулю блюд вернул 12 объектов класса DishCategory, по модулю полуфабрикатов
// — 4 объекта SemiCategory. То есть иерархия здесь ровно как у ингредиентов:
// корень — категории, товары лежат ниже.
const DISH_CATEGORY_CLASS =
  "ru.edgex.quickresto.modules.warehouse.nomenclature.dish.DishCategory";
const SEMIPRODUCT_CATEGORY_CLASS =
  "ru.edgex.quickresto.modules.warehouse.nomenclature.semiproduct.SemiCategory";

const STORE_CLASS = "ru.edgex.quickresto.modules.warehouse.store.Store";
const STORE_MODULE = "warehouse.store";

const INVENTORY_DOCUMENT_READ_CLASS =
  "ru.edgex.quickresto.modules.warehouse.inventory.document.InventoryDocument";
const INVENTORY_DOCUMENT_READ_MODULE = "warehouse.inventory.document";
const INVENTORY_DOCUMENT_UPDATE_CLASS =
  "ru.edgex.quickresto.modules.warehouse.inventory.document.InventoryDocument2";
const INVENTORY_DOCUMENT_UPDATE_MODULE = "warehouse.inventory.document.v2";

const QUICK_RESTO_REQUEST_TIMEOUT_MS = 20_000;

function withAuthHeader(login: string, password: string): HeadersInit {
  const encoded = Buffer.from(`${login}:${password}`).toString("base64");
  return {
    Authorization: `Basic ${encoded}`,
    Connection: "keep-alive",
    "Content-Type": "application/json",
  };
}

function buildBaseUrl(layerName: string) {
  return `https://${layerName}.quickresto.ru/platform/online/api`;
}

export function buildQuickRestoBackOfficeOrigin(input: {
  layerName: string;
  baseUrl?: string | null;
}) {
  const raw = input.layerName
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\.quickresto\.ru$/i, "")
    .trim();
  return `https://${raw}.quickresto.ru`;
}

function splitCombinedSetCookieHeader(value: string) {
  return value.split(/,(?=\s*[A-Za-z0-9_-]+=)/g).map((part) => part.trim()).filter(Boolean);
}

function getSetCookieHeaders(headers: Headers) {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === "function") {
    return withGetSetCookie.getSetCookie();
  }

  const raw = headers.get("set-cookie");
  return raw ? splitCombinedSetCookieHeader(raw) : [];
}

export function buildQuickRestoBackOfficeCookieHeader(setCookieHeaders: string[]) {
  const pairs = setCookieHeaders
    .map((value) => String(value).split(";")[0]?.trim())
    .filter((value): value is string => Boolean(value && value.includes("=")));

  // Merge по имени: более поздний Set-Cookie перезаписывает прежний
  // (семантика map, как в n8n-флоу входа в Keycloak).
  const byName = new Map<string, string>();
  for (const pair of pairs) {
    const name = pair.split("=")[0]?.trim();
    if (!name) continue;
    byName.set(name, pair);
  }

  return Array.from(byName.values()).join("; ");
}

const KEYCLOAK_AUTH_BASE = "https://id.quickresto.ru/realms/QR/protocol/openid-connect";
const KEYCLOAK_CLIENT_ID = "qrbo-frontend";

// Маршрут прода (Timeweb, СПб) → id.quickresto.ru периодически деградирует
// (40–60% потерь, таймауты TCP-коннекта; диагноз — mtr/curl с прода). Это
// pre-delivery сетевые сбои, их имеет смысл ретраить; HTTP-ответы (в т.ч.
// 5xx), TLS-ошибки и наш собственный 20с-таймаут — нет.
const QUICK_RESTO_RETRYABLE_NETWORK_CODES: ReadonlySet<string> = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ECONNABORTED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

// Задержки между 1-й и 2-й, 2-й и 3-й попыткой (итого 3 попытки, ≤ ~34с при
// undici connect-timeout 10с на попытку — укладывается в server-action лимит).
const QUICK_RESTO_FETCH_RETRY_DELAYS_MS = [1_000, 3_000] as const;

function isRetryableQuickRestoNetworkError(error: unknown): boolean {
  const code = (error as { cause?: { code?: string } })?.cause?.code;
  return code !== undefined && QUICK_RESTO_RETRYABLE_NETWORK_CODES.has(code);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// Node кидает сырой TypeError("fetch failed") с cause (ENOTFOUND, ECONNREFUSED,
// ECONNRESET, CERT_* …). Без раскрытия причины в UI непонятно, что сломалось —
// DNS, TLS или файрвол. Прячем за сообщением с хостом и кодом.
function throwQuickRestoNetworkError(url: string, error: unknown): never {
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  const code = cause?.code;
  const detail =
    cause?.message || (error instanceof Error ? error.message : String(error));
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // не-URL — оставляем как есть
  }
  throw new Error(
    `Quick Resto: не удалось соединиться с ${host}${code ? ` (${code})` : ""}: ${detail}`,
  );
}

// Только для KC-флоу входа (4 шага) и его рефреша: data-вызовы на
// chilling/nx815 идут через callQuickRestoBackOfficeData и ретраятся
// намеренно — часть POST/DELETE не идемпотентна, а сам маршрут здоров.
export async function quickRestoFetch(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), QUICK_RESTO_REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...init,
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `Quick Resto back-office request timed out after ${QUICK_RESTO_REQUEST_TIMEOUT_MS / 1000}s`,
        );
      }
      const delay = QUICK_RESTO_FETCH_RETRY_DELAYS_MS[attempt];
      if (delay !== undefined && isRetryableQuickRestoNetworkError(error)) {
        await sleep(delay);
        continue;
      }
      throwQuickRestoNetworkError(url, error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

// Keycloak отдаёт loginAction-URL в JSON-теле HTML-страницы, где слэши
// экранированы (\"…\/…\") — вытаскиваем и декодируем, как в n8n-флоу.
function extractKeycloakLoginAction(body: string): string | null {
  const match = body.match(/"loginAction":\s*"([^"]+)"/);
  if (!match) return null;
  return match[1].replace(/\\\//g, "/");
}

// Аккумуляция cookies между шагами KC-флоу: более поздний Set-Cookie
// перезаписывает cookie с тем же именем (map-семантика как в n8n).
function mergeKeycloakCookieHeader(prev: string, setCookieHeaders: string[]) {
  const prevPairs = prev
    ? prev.split("; ").filter(Boolean).map((pair) => `${pair};`)
    : [];
  return buildQuickRestoBackOfficeCookieHeader([...prevPairs, ...setCookieHeaders]);
}

function keycloakQueryParam(url: string, key: string): string | null {
  const query = url.split("?")[1] ?? "";
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    const name = decodeURIComponent(eq > -1 ? pair.slice(0, eq) : pair);
    if (name === key) {
      return eq > -1 ? decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " ")) : "";
    }
  }
  return null;
}

/**
 * Вход в Quick Resto back-office через Keycloak (после перехода QR со
 * Spring-security на OIDC; см. n8n-флоу «QR / Login Keycloak»):
 *
 *   1. GET  /realms/QR/.../auth?client_id=qrbo-frontend&redirect_uri=…  → cookies + loginAction
 *   2. POST loginAction  (identifier, identifierType=loginOrEmail)      → cookies + loginAction
 *   3. POST loginAction  (password)                                     → Location с ?code=
 *   4. POST /realms/QR/.../token (authorization_code)                   → access_token
 *
 * Возвращает Authorization-заголовок («Bearer …») и срок жизни токена.
 */
export async function loginQuickRestoBackOffice(input: {
  layerName: string;
  baseUrl?: string | null;
  login: string;
  password: string;
}) {
  const redirectUri = `${buildQuickRestoBackOfficeOrigin(input)}/`;

  // Шаг 1: страница логина (ставит KC-cookies, отдаёт loginAction).
  const authUrl =
    `${KEYCLOAK_AUTH_BASE}/auth?${new URLSearchParams({
      client_id: KEYCLOAK_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid",
      response_mode: "query",
    }).toString()}`;
  const authPage = await quickRestoFetch(authUrl, { method: "GET" });
  if (authPage.status >= 400) {
    const body = await authPage.text();
    throw new Error(quickRestoErrorMessage(authPage.status, body));
  }
  let cookieHeader = buildQuickRestoBackOfficeCookieHeader(
    getSetCookieHeaders(authPage.headers),
  );
  let loginAction = extractKeycloakLoginAction(await authPage.text());
  if (!loginAction) {
    throw new Error("Quick Resto (Keycloak): loginAction не найден на странице входа");
  }

  // Шаг 2: идентификатор (логин/email).
  const identifierResponse = await quickRestoFetch(loginAction, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: new URLSearchParams({
      identifier: input.login,
      identifierType: "loginOrEmail",
    }).toString(),
  });
  cookieHeader = mergeKeycloakCookieHeader(
    cookieHeader,
    getSetCookieHeaders(identifierResponse.headers),
  );
  const identifierBody = await identifierResponse.text();
  loginAction = extractKeycloakLoginAction(identifierBody);
  if (!loginAction) {
    throw new Error(
      `Quick Resto (Keycloak): не получен loginAction после ввода логина (статус ${identifierResponse.status}): ${identifierBody.slice(0, 200)}`,
    );
  }

  // Шаг 3: пароль. Успех = redirect с ?code= в Location.
  const passwordResponse = await quickRestoFetch(loginAction, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: new URLSearchParams({ password: input.password }).toString(),
  });
  const location = passwordResponse.headers.get("location");
  const code = location ? keycloakQueryParam(location, "code") : null;
  if (!code) {
    // KC при неверном пароле re-render-ит форму логина вместо redirect'а.
    if (passwordResponse.status < 400 && !location) {
      throw new Error("Неверный логин или пароль back-office пользователя Quick Resto");
    }
    const body = await passwordResponse.text();
    throw new Error(
      `Quick Resto (Keycloak): не получен code после ввода пароля (статус ${passwordResponse.status}): ${body.slice(0, 200)}`,
    );
  }

  // Шаг 4: обмен code на access_token.
  const tokenResponse = await quickRestoFetch(`${KEYCLOAK_AUTH_BASE}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: KEYCLOAK_CLIENT_ID,
    }).toString(),
  });
  const tokenText = await tokenResponse.text();
  let tokenPayload: {
    access_token?: string;
    expires_in?: number | string;
  } = {};
  try {
    tokenPayload = JSON.parse(tokenText) as typeof tokenPayload;
  } catch {
    // ошибка ниже с куском body
  }
  if (!tokenPayload.access_token) {
    throw new Error(
      `Quick Resto (Keycloak): token exchange не вернул access_token (статус ${tokenResponse.status}): ${tokenText.slice(0, 300)}`,
    );
  }

  const expiresIn =
    typeof tokenPayload.expires_in === "number"
      ? tokenPayload.expires_in
      : typeof tokenPayload.expires_in === "string" && tokenPayload.expires_in.trim()
        ? Number(tokenPayload.expires_in)
        : null;

  return {
    authorization: `Bearer ${tokenPayload.access_token}`,
    expiresInSeconds: Number.isFinite(expiresIn) ? expiresIn : null,
    status: tokenResponse.status,
  };
}

async function callQuickRestoBackOfficeData<T>(input: {
  layerName: string;
  baseUrl?: string | null;
  /** Authorization-заголовок сессии: «Bearer <access_token>» из Keycloak-флоу. */
  authorization: string;
  path: string;
  query?: Record<string, string | number | null | undefined>;
  body?: unknown;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const origin = buildQuickRestoBackOfficeOrigin(input);
  const url = `${origin}/platform/data/${input.path}${params.size > 0 ? `?${params.toString()}` : ""}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUICK_RESTO_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: input.body === undefined ? "GET" : "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        Connection: "keep-alive",
        "Content-Type": "application/json; charset=UTF-8",
        Authorization: input.authorization,
        Origin: origin,
        Referer: `${origin}/`,
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Quick Resto back-office request timed out after ${QUICK_RESTO_REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throwQuickRestoNetworkError(url, error);
  } finally {
    clearTimeout(timeout);
  }

  if (
    response.status === 401 ||
    response.status === 403 ||
    (response.status >= 300 && response.status < 400)
  ) {
    throw new Error(`Quick Resto back-office auth failed (${response.status})`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(quickRestoErrorMessage(response.status, body));
  }

  const text = await response.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Класс документа инвентаризации, который QR возвращает в ответах и принимает
 * при create. NB: он отличается от `INVENTORY_DOCUMENT_UPDATE_CLASS`
 * (`…document.InventoryDocument2`) — при create второй вариант отвечает 400
 * «entityNotFound». Проверено на проде 2026-08-26.
 */
const INVENTORY_DOCUMENT_CREATE_CLASS =
  "ru.edgex.quickresto.modules.warehouse.inventory.document.v2.InventoryDocument";

const INVENTORY_ITEMS_OWNER_CLASS =
  "ru.edgex.quickresto.modules.warehouse.inventory.document.v2.InventoryDocument";

/**
 * Создать акт инвентаризации на заданную дату.
 *
 * Public API для этого не годится: `update` без objectId отвечает 400
 * «Entity with id null does not exist». Работает только backoffice-эндпоинт
 * `warehouse.inventory.document.v2/create`. Акт создаётся ПУСТЫМ — позиции
 * добавляются отдельно (`createInventoryItemBackOffice`).
 *
 * Удаления акта в API нет (перебраны delete/remove/action) — при сбое на
 * середине операции документ придётся убирать руками в Quick Resto. Поэтому
 * вызывающий код обязан быть идемпотентным: запомнить id созданного акта и при
 * повторе продолжать, а не создавать второй.
 */
export async function createInventoryDocumentBackOffice(input: {
  layerName: string;
  baseUrl?: string | null;
  /** Authorization-заголовок сессии: «Bearer <access_token>». */
  authorization: string;
  storeId: number;
  /** Дата акта в миллисекундах. QR трактует её в таймзоне заведения. */
  invoiceDate: number;
  comment?: string | null;
}) {
  return callQuickRestoBackOfficeData<QuickRestoInventoryDocument2>({
    layerName: input.layerName,
    baseUrl: input.baseUrl,
    authorization: input.authorization,
    path: "warehouse.inventory.document.v2/create",
    query: {
      regTime: Date.now(),
      businessDayOffsetInMs: 32_400_000,
      timeZone: new Date().getTimezoneOffset(),
    },
    body: {
      className: INVENTORY_DOCUMENT_CREATE_CLASS,
      store: { id: input.storeId, className: STORE_CLASS },
      invoiceDate: input.invoiceDate,
      comment: input.comment ?? "",
    },
  });
}

/** Поля строки акта, которые принадлежат КОНКРЕТНОЙ строке, а не товару. */
const INVENTORY_ITEM_ROW_FIELDS = [
  "id",
  "hash",
  "version",
  "seqNumber",
  "_Level",
  "_Locked",
  "transient",
  "historical",
  "permanent",
  "delta",
  "differenceCost",
  "amountAtStore",
  "storeQuantity",
  "storeQuantityKg",
  "amountTotal",
  "effectiveAmount",
  "actualAmount",
  "costPriceSum",
  "costPriceSumKg",
] as const;

/**
 * Добавить позицию в акт по образцу строки другого акта (raw_payload).
 *
 * Служебные поля исходной строки вычищаются: расчётный остаток, разницу и
 * себестоимость Quick Resto посчитает сам — уже на дату нового акта. Ровно это
 * и нужно акту пересчёта.
 */
export async function createInventoryItemBackOffice(input: {
  layerName: string;
  baseUrl?: string | null;
  /** Authorization-заголовок сессии: «Bearer <access_token>». */
  authorization: string;
  documentId: number;
  /** Строка-образец: raw_payload позиции исходного акта. */
  sample: QuickRestoInventoryItem2;
  actualAmount?: number;
}) {
  const sample = cloneJson(input.sample) as Record<string, unknown>;
  for (const field of INVENTORY_ITEM_ROW_FIELDS) delete sample[field];

  return callQuickRestoBackOfficeData<QuickRestoInventoryItem2>({
    layerName: input.layerName,
    baseUrl: input.baseUrl,
    authorization: input.authorization,
    path: "warehouse.inventory.items/create",
    query: {
      ownerContextId: input.documentId,
      ownerContextClassName: INVENTORY_ITEMS_OWNER_CLASS,
      regTime: Date.now(),
      businessDayOffsetInMs: 32_400_000,
      timeZone: new Date().getTimezoneOffset(),
    },
    body: { ...sample, actualAmount: input.actualAmount ?? 0 },
  });
}

/**
 * Удалить позицию из акта и удалить сам акт.
 *
 * Обе операции — `DELETE` на `<module>/remove` **с телом** (полный объект) и с
 * `regTime`. Именно так это делает интерфейс Quick Resto; без тела эндпоинт
 * отвечает «Object doesn't exist», а POST — 405. Отдельного `/delete` нет.
 */
async function callQuickRestoBackOfficeRemove<T>(input: {
  layerName: string;
  baseUrl?: string | null;
  /** Authorization-заголовок сессии: «Bearer <access_token>». */
  authorization: string;
  path: string;
  query: Record<string, string | number | null | undefined>;
  body: unknown;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input.query)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const origin = buildQuickRestoBackOfficeOrigin(input);
  const url = `${origin}/platform/data/${input.path}?${params.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUICK_RESTO_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "DELETE",
      headers: {
        Accept: "application/json, text/plain, */*",
        Connection: "keep-alive",
        "Content-Type": "application/json; charset=UTF-8",
        Origin: origin,
        Referer: `${origin}/`,
        Authorization: input.authorization,
      },
      body: JSON.stringify(input.body),
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Quick Resto back-office request timed out after ${QUICK_RESTO_REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throwQuickRestoNetworkError(url, error);
  } finally {
    clearTimeout(timeout);
  }

  if (
    response.status === 401 ||
    response.status === 403 ||
    (response.status >= 300 && response.status < 400)
  ) {
    throw new Error(`Quick Resto back-office auth failed (${response.status})`);
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(quickRestoErrorMessage(response.status, body));
  }
  const text = await response.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

/** Удалить позицию из акта инвентаризации. */
export async function removeInventoryItemBackOffice(input: {
  layerName: string;
  baseUrl?: string | null;
  /** Authorization-заголовок сессии: «Bearer <access_token>». */
  authorization: string;
  documentId: number;
  /** Полный объект позиции — QR принимает его телом запроса. */
  item: QuickRestoInventoryItem2;
}) {
  const rawHash = (input.item as Record<string, unknown>).hash;
  return callQuickRestoBackOfficeRemove<unknown>({
    layerName: input.layerName,
    baseUrl: input.baseUrl,
    authorization: input.authorization,
    path: "warehouse.inventory.items/remove",
    query: {
      ownerContextId: input.documentId,
      ownerContextClassName: INVENTORY_ITEMS_OWNER_CLASS,
      regTime: Date.now(),
      hash: typeof rawHash === "string" || typeof rawHash === "number" ? rawHash : undefined,
      businessDayOffsetInMs: 32_400_000,
      timeZone: -180,
    },
    body: input.item,
  });
}

/** Удалить акт инвентаризации целиком (нужен для отката незавершённого переноса). */
export async function removeInventoryDocumentBackOffice(input: {
  layerName: string;
  baseUrl?: string | null;
  /** Authorization-заголовок сессии: «Bearer <access_token>». */
  authorization: string;
  document: QuickRestoInventoryDocument2;
}) {
  return callQuickRestoBackOfficeRemove<unknown>({
    layerName: input.layerName,
    baseUrl: input.baseUrl,
    authorization: input.authorization,
    path: "warehouse.inventory.document.v2/remove",
    query: {
      mode: "previous30Days",
      regTime: Date.now(),
      contextModule: "warehouse.inventory.items",
      businessDayOffsetInMs: 32_400_000,
      timeZone: -180,
    },
    body: { ...input.document, className: INVENTORY_DOCUMENT_CREATE_CLASS },
  });
}

export async function updateInventoryItemBackOffice(input: {
  layerName: string;
  baseUrl?: string | null;
  authorization: string;
  documentId: number;
  item: QuickRestoInventoryItem2;
  actualAmount: number;
}) {
  const original = cloneJson(input.item);
  const body = {
    ...original,
    actualAmount: input.actualAmount,
    original_entity_sent: cloneJson(original),
  };
  const rawHash = (input.item as Record<string, unknown>).hash;

  return callQuickRestoBackOfficeData<QuickRestoInventoryItem2>({
    layerName: input.layerName,
    baseUrl: input.baseUrl,
    authorization: input.authorization,
    path: "warehouse.inventory.items/update",
    query: {
      ownerContextId: input.documentId,
      ownerContextClassName:
        "ru.edgex.quickresto.modules.warehouse.inventory.document.v2.InventoryDocument",
      regTime: Date.now(),
      hash: typeof rawHash === "string" || typeof rawHash === "number" ? rawHash : undefined,
      businessDayOffsetInMs: 32_400_000,
      timeZone: new Date().getTimezoneOffset(),
    },
    body,
  });
}

function backOfficeSelectRows<T>(response: QuickRestoBackOfficeSelectResponse<T>) {
  if (Array.isArray(response)) return { rows: response, total: response.length };
  if (Array.isArray(response.ds)) {
    const rows = response.ds
      .map((row) => {
        if (row && typeof row === "object" && "object" in row) {
          return (row as { object?: T }).object;
        }
        return row as T;
      })
      .filter((row): row is T => Boolean(row));
    return { rows, total: rows.length };
  }
  const rows =
    response.data ??
    response.rows ??
    response.items ??
    response.list ??
    response.result ??
    [];
  const total =
    typeof response.total === "number"
      ? response.total
      : typeof response.totalCount === "number"
        ? response.totalCount
        : typeof response.count === "number"
          ? response.count
          : rows.length;
  return { rows, total };
}

export async function selectInventoryItemsBackOffice(input: {
  layerName: string;
  baseUrl?: string | null;
  authorization: string;
  documentId: number;
  start?: number;
  count?: number;
  sortField?: string;
  sortOrder?: "asc" | "desc";
}) {
  const response = await callQuickRestoBackOfficeData<
    QuickRestoBackOfficeSelectResponse<QuickRestoInventoryItem2>
  >({
    layerName: input.layerName,
    baseUrl: input.baseUrl,
    authorization: input.authorization,
    path: "warehouse.inventory.items/select",
    query: {
      start: input.start ?? 0,
      count: input.count ?? 150,
      ownerContextId: input.documentId,
      ownerContextClassName:
        "ru.edgex.quickresto.modules.warehouse.inventory.document.v2.InventoryDocument",
      "sortField[]": input.sortField ?? "product",
      "sortOrder[]": input.sortOrder ?? "desc",
      businessDayOffsetInMs: 32_400_000,
      timeZone: new Date().getTimezoneOffset(),
    },
  });

  return backOfficeSelectRows(response);
}

export async function listInventoryItemsBackOffice(input: {
  layerName: string;
  baseUrl?: string | null;
  authorization: string;
  documentId: number;
  count?: number;
}) {
  const pageSize = Math.max(1, input.count ?? 150);
  const rows: QuickRestoInventoryItem2[] = [];
  // Страховка от бесконечного цикла, если backoffice начнёт отдавать одну и ту
  // же страницу: 200 страниц × 500 = 100 000 позиций, дальше любого реального акта.
  const MAX_PAGES = 200;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { rows: pageRows } = await selectInventoryItemsBackOffice({
      ...input,
      start: page * pageSize,
      count: pageSize,
    });
    rows.push(...pageRows);
    // Признак конца — неполная страница. По `total` останавливаться нельзя:
    // для ответа в форме `{ds: [...]}` (и для голого массива) backOfficeSelectRows
    // выводит total из длины ТЕКУЩЕЙ страницы, поэтому после первой полной
    // страницы условие `rows.length >= total` срабатывало всегда — акт длиннее
    // pageSize молча обрезался, а «лишние» строки затем удалялись как stale.
    if (pageRows.length < pageSize) break;
  }

  return rows;
}

async function callQuickResto<T>(input: {
  layerName: string;
  login: string;
  password: string;
  path: "list" | "read" | "update";
  moduleName: string;
  className: string;
  objectId?: number;
  body?: unknown;
}): Promise<T> {
  const params = new URLSearchParams({
    moduleName: input.moduleName,
    className: input.className,
  });

  if (input.path === "read") {
    if (typeof input.objectId !== "number") {
      throw new Error("Quick Resto read requires objectId");
    }
    params.set("objectId", String(input.objectId));
  }
  if (input.path === "update" && typeof input.objectId === "number") {
    params.set("objectId", String(input.objectId));
  }

  const url = `${buildBaseUrl(input.layerName)}/${input.path}?${params.toString()}`;
  const headers = {
    ...withAuthHeader(input.login, input.password),
    "Content-Type": "application/json",
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUICK_RESTO_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: input.path === "update" || input.body ? "POST" : "GET",
      headers,
      body: input.path === "update" || input.body ? JSON.stringify(input.body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Quick Resto request timed out after ${QUICK_RESTO_REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throwQuickRestoNetworkError(url, error);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401) {
    throw new Error("Quick Resto auth failed (401)");
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(quickRestoErrorMessage(response.status, body));
  }

  return (await response.json()) as T;
}

function quickRestoErrorMessage(status: number, body: string) {
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  const summary = text ? `: ${text.slice(0, 500)}` : "";
  return `Quick Resto вернул ошибку ${status}${summary}`;
}

export async function listTableSchemes(input: {
  layerName: string;
  login: string;
  password: string;
}) {
  return callQuickResto<QuickRestoTableScheme[]>({
    ...input,
    path: "list",
    moduleName: TABLE_SCHEME_MODULE,
    className: TABLE_SCHEME_CLASS,
  });
}

export async function readTableScheme(input: {
  layerName: string;
  login: string;
  password: string;
  objectId: number;
}) {
  return callQuickResto<QuickRestoTableScheme>({
    ...input,
    path: "read",
    moduleName: TABLE_SCHEME_MODULE,
    className: TABLE_SCHEME_CLASS,
  });
}

export async function listRoles(input: {
  layerName: string;
  login: string;
  password: string;
}) {
  return callQuickResto<QuickRestoRole[]>({
    ...input,
    path: "list",
    moduleName: ROLE_MODULE,
    className: ROLE_CLASS,
  });
}

export async function readRole(input: {
  layerName: string;
  login: string;
  password: string;
  objectId: number;
}) {
  return callQuickResto<QuickRestoRole>({
    ...input,
    path: "read",
    moduleName: ROLE_MODULE,
    className: ROLE_CLASS,
  });
}

export async function listEmployees(input: {
  layerName: string;
  login: string;
  password: string;
}) {
  return callQuickResto<QuickRestoEmployeeListItem[]>({
    ...input,
    path: "list",
    moduleName: EMPLOYEE_MODULE,
    className: EMPLOYEE_CLASS,
  });
}

export async function readEmployee(input: {
  layerName: string;
  login: string;
  password: string;
  objectId: number;
}) {
  return callQuickResto<QuickRestoEmployeeRead>({
    ...input,
    path: "read",
    moduleName: EMPLOYEE_MODULE,
    className: EMPLOYEE_CLASS,
  });
}

export async function listIngredientGroups(input: {
  layerName: string;
  login: string;
  password: string;
}) {
  return callQuickResto<QuickRestoSingleCategory[]>({
    ...input,
    path: "list",
    moduleName: SINGLE_PRODUCT_MODULE,
    className: SINGLE_CATEGORY_CLASS,
  });
}

export async function readIngredientGroup(input: {
  layerName: string;
  login: string;
  password: string;
  objectId: number;
}) {
  return callQuickResto<QuickRestoSingleCategory>({
    ...input,
    path: "read",
    moduleName: SINGLE_PRODUCT_MODULE,
    className: SINGLE_CATEGORY_CLASS,
  });
}

export async function listIngredients(input: {
  layerName: string;
  login: string;
  password: string;
}) {
  return callQuickResto<QuickRestoSingleProduct[]>({
    ...input,
    path: "list",
    moduleName: SINGLE_PRODUCT_MODULE,
    className: SINGLE_PRODUCT_CLASS,
  });
}

export async function listIngredientTreeItems(input: {
  layerName: string;
  login: string;
  password: string;
}) {
  const [rootItems, nestedItems] = await Promise.all([
    listIngredients(input),
    callQuickResto<QuickRestoStoreItem[]>({
      ...input,
      path: "list",
      moduleName: SINGLE_PRODUCT_MODULE,
      className: SINGLE_PRODUCT_CLASS,
      // Quick Resto's plain list returns only root-level store items. A
      // parentId filter returns the full nested catalog, including categories.
      body: { filters: [{ field: "parentId", operation: "neq", value: "0" }] },
    }),
  ]);

  const byClassAndId = new Map<string, QuickRestoStoreItem>();
  for (const item of [...rootItems, ...nestedItems]) {
    if (typeof item.id !== "number") continue;
    const type = typeof item.className === "string" ? item.className : "unknown";
    byClassAndId.set(`${type}:${item.id}`, item);
  }

  return Array.from(byClassAndId.values());
}

export async function readIngredient(input: {
  layerName: string;
  login: string;
  password: string;
  objectId: number;
}) {
  return callQuickResto<QuickRestoSingleProduct>({
    ...input,
    path: "read",
    moduleName: SINGLE_PRODUCT_MODULE,
    className: SINGLE_PRODUCT_CLASS,
  });
}

// Блюда / полуфабрикаты — плоский list. ВНИМАНИЕ: он отдаёт не товары, а
// корневые КАТЕГОРИИ (проба на живом подключении: 12 объектов DishCategory и
// 4 объекта SemiCategory). Оставлены как есть — на них опирается диагностика.
// Для содержимого нужен listNomenclatureTreeItems ниже.
export async function listDishes(input: {
  layerName: string;
  login: string;
  password: string;
}) {
  return callQuickResto<QuickRestoSingleProduct[]>({
    ...input,
    path: "list",
    moduleName: DISH_MODULE,
    className: DISH_CLASS,
  });
}

export async function listSemiProducts(input: {
  layerName: string;
  login: string;
  password: string;
}) {
  return callQuickResto<QuickRestoSingleProduct[]>({
    ...input,
    path: "list",
    moduleName: SEMIPRODUCT_MODULE,
    className: SEMIPRODUCT_CLASS,
  });
}

/**
 * Полное дерево номенклатуры одного модуля: корневые элементы плюс всё
 * вложенное.
 *
 * Тот же приём, что и в listIngredientTreeItems: плоский list отдаёт только
 * корень, а фильтр `parentId neq 0` возвращает вложенный каталог вместе с
 * категориями. Вынесено в общий фетчер, потому что для блюд и полуфабрикатов
 * нужен ровно он же — модули устроены параллельно.
 *
 * Дедупликация по паре класс+id: один и тот же объект приходит и из корневого
 * списка, и из вложенного, а id уникальны только внутри класса.
 */
async function listNomenclatureTreeItems(input: {
  layerName: string;
  login: string;
  password: string;
  moduleName: string;
  className: string;
}) {
  const { moduleName, className, ...auth } = input;
  const [rootItems, nestedItems] = await Promise.all([
    callQuickResto<QuickRestoStoreItem[]>({ ...auth, path: "list", moduleName, className }),
    callQuickResto<QuickRestoStoreItem[]>({
      ...auth,
      path: "list",
      moduleName,
      className,
      body: { filters: [{ field: "parentId", operation: "neq", value: "0" }] },
    }),
  ]);

  const byClassAndId = new Map<string, QuickRestoStoreItem>();
  for (const item of [...rootItems, ...nestedItems]) {
    if (typeof item.id !== "number") continue;
    const type = typeof item.className === "string" ? item.className : "unknown";
    byClassAndId.set(`${type}:${item.id}`, item);
  }
  return Array.from(byClassAndId.values());
}

export async function listDishTreeItems(input: {
  layerName: string;
  login: string;
  password: string;
}) {
  return listNomenclatureTreeItems({
    ...input,
    moduleName: DISH_MODULE,
    className: DISH_CLASS,
  });
}

export async function listSemiProductTreeItems(input: {
  layerName: string;
  login: string;
  password: string;
}) {
  return listNomenclatureTreeItems({
    ...input,
    moduleName: SEMIPRODUCT_MODULE,
    className: SEMIPRODUCT_CLASS,
  });
}

/** Классы категорий — чтобы вызывающая сторона отличала категорию от товара. */
export const QUICK_RESTO_CATEGORY_CLASSES = {
  ingredient: SINGLE_CATEGORY_CLASS,
  dish: DISH_CATEGORY_CLASS,
  semi_finished: SEMIPRODUCT_CATEGORY_CLASS,
} as const;

export async function listStores(input: {
  layerName: string;
  login: string;
  password: string;
}) {
  return callQuickResto<QuickRestoStore[]>({
    ...input,
    path: "list",
    moduleName: STORE_MODULE,
    className: STORE_CLASS,
  });
}

export async function readStore(input: {
  layerName: string;
  login: string;
  password: string;
  objectId: number;
}) {
  return callQuickResto<QuickRestoStore>({
    ...input,
    path: "read",
    moduleName: STORE_MODULE,
    className: STORE_CLASS,
  });
}

export async function listInventoryDocuments(input: {
  layerName: string;
  login: string;
  password: string;
}) {
  return callQuickResto<QuickRestoInventoryDocument2[]>({
    ...input,
    path: "list",
    moduleName: INVENTORY_DOCUMENT_UPDATE_MODULE,
    className: INVENTORY_DOCUMENT_UPDATE_CLASS,
  });
}

export async function readInventoryDocument(input: {
  layerName: string;
  login: string;
  password: string;
  objectId: number;
}) {
  return callQuickResto<QuickRestoInventoryDocument2>({
    ...input,
    path: "read",
    moduleName: INVENTORY_DOCUMENT_READ_MODULE,
    className: INVENTORY_DOCUMENT_READ_CLASS,
  });
}

/**
 * Backoffice-action «провести акт».
 *
 *   POST {origin}/platform/data/warehouse.inventory.document.v2/action
 *        ?businessDayOffsetInMs=32400000&timeZone=0
 *   Headers (минимальный набор, без Origin/Referer/Accept):
 *     Authorization: Bearer <access_token>   ← Keycloak-сессия (флоу loginQuickRestoBackOffice)
 *     Connection: keep-alive
 *     Content-Type: application/json; charset=utf-8
 *
 * Исторически (до перехода QR на Keycloak) Spring требовал здесь ОДНОВРЕМЕННО
 * cookie-сессию и Authorization: Basic с API-creds. После OIDC-миграции
 * идентичность даёт Bearer-токен; Basic в этот же заголовок не помещается
 * (HTTP-заголовок Authorization один), поэтому шлём только Bearer. Если на
 * живом вызове /action начнёт отдавать 401/403 — смотрим тело ответа и
 * уточняем у Quick Resto, нужен ли ещё один фактор.
 *
 * Диагностика: при 401/403 логируем тело (бывает «Access is denied»
 * или имя ожидаемой роли).
 */
export async function processInventoryDocumentBackOffice(input: {
  layerName: string;
  baseUrl?: string | null;
  /** Authorization-заголовок сессии: «Bearer <access_token>». */
  authorization: string;
  documentId: number;
}) {
  const origin = buildQuickRestoBackOfficeOrigin(input);
  const url =
    `${origin}/platform/data/warehouse.inventory.document.v2/action` +
    `?businessDayOffsetInMs=32400000&timeZone=0`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QUICK_RESTO_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: input.authorization,
        Connection: "keep-alive",
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        actionName: "process",
        ids: [input.documentId],
        data: {
          start: 0,
          count: 150,
          mode: "previous30Days",
          sortField: ["invoiceDate"],
          sortOrder: ["desc"],
          timeZone: 0,
        },
      }),
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `Quick Resto back-office request timed out after ${QUICK_RESTO_REQUEST_TIMEOUT_MS / 1000}s`,
      );
    }
    throwQuickRestoNetworkError(url, error);
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 401 || response.status === 403) {
    // 401 = токен не дал auth (просрочен/невалидна) → wrapper рефрешит и ретраит.
    // 403 = auth ok, но user не имеет нужной роли → не лечится ретраем; пробрасываем
    // сырой текст, чтобы было видно «какой role не хватает».
    const body = await response.text();
    if (response.status === 401) {
      throw new Error(`Quick Resto back-office auth failed (401): ${body.slice(0, 400)}`);
    }
    throw new Error(
      `Quick Resto /action — 403 (нет прав у backoffice-юзера). Spring: ${body.slice(0, 400) || "<empty body>"}`,
    );
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(quickRestoErrorMessage(response.status, body));
  }
  const text = await response.text();
  if (!text.trim()) return {} as unknown;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text as unknown;
  }
}

export async function updateInventoryDocument(input: {
  layerName: string;
  login: string;
  password: string;
  document: QuickRestoInventoryDocument2;
}) {
  return callQuickResto<QuickRestoInventoryDocument2>({
    layerName: input.layerName,
    login: input.login,
    password: input.password,
    path: "update",
    moduleName: INVENTORY_DOCUMENT_UPDATE_MODULE,
    className: INVENTORY_DOCUMENT_UPDATE_CLASS,
    objectId: input.document.id,
    body: input.document,
  });
}
