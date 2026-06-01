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

function buildBackOfficeBaseUrl(input: {
  layerName: string;
  baseUrl?: string | null;
}) {
  return `${buildQuickRestoBackOfficeOrigin(input)}/platform`;
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

  const byName = new Map<string, string>();
  for (const pair of pairs) {
    const name = pair.split("=")[0]?.trim();
    if (!name) continue;
    byName.set(name, pair);
  }

  return Array.from(byName.values())
    .sort((a, b) => {
      const aSession = a.startsWith("JSESSIONID=");
      const bSession = b.startsWith("JSESSIONID=");
      if (aSession === bSession) return 0;
      return aSession ? -1 : 1;
    })
    .join("; ");
}

export async function loginQuickRestoBackOffice(input: {
  layerName: string;
  baseUrl?: string | null;
  login: string;
  password: string;
}) {
  const params = new URLSearchParams({
    j_username: input.login,
    j_password: input.password,
    j_rememberme: "true",
  });
  const url = `${buildBackOfficeBaseUrl(input)}/j_spring_security_check?${params.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUICK_RESTO_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Connection: "keep-alive",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Quick Resto back-office login timed out after ${QUICK_RESTO_REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401) {
    throw new Error("Неверный логин или пароль back-office пользователя Quick Resto");
  }

  if (response.status >= 400) {
    const body = await response.text();
    throw new Error(quickRestoErrorMessage(response.status, body));
  }

  const cookieHeader = buildQuickRestoBackOfficeCookieHeader(getSetCookieHeaders(response.headers));
  if (!cookieHeader || !cookieHeader.includes("JSESSIONID=")) {
    throw new Error("Quick Resto не вернул сессионные cookies для back-office пользователя");
  }

  return {
    cookieHeader,
    status: response.status,
  };
}

async function callQuickRestoBackOfficeData<T>(input: {
  layerName: string;
  baseUrl?: string | null;
  cookieHeader: string;
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
        Cookie: input.cookieHeader,
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
    throw error;
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

export async function updateInventoryItemBackOffice(input: {
  layerName: string;
  baseUrl?: string | null;
  cookieHeader: string;
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
    cookieHeader: input.cookieHeader,
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
  cookieHeader: string;
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
    cookieHeader: input.cookieHeader,
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
  cookieHeader: string;
  documentId: number;
  count?: number;
}) {
  const pageSize = Math.max(1, input.count ?? 150);
  const rows: QuickRestoInventoryItem2[] = [];
  let total: number | null = null;

  for (let start = 0; ; start += pageSize) {
    const page = await selectInventoryItemsBackOffice({
      ...input,
      start,
      count: pageSize,
    });
    rows.push(...page.rows);
    total = page.total;
    if (page.rows.length < pageSize) break;
    if (total !== null && rows.length >= total) break;
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
    throw error;
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
 * Backoffice-action «провести акт» (то же, что юзер делает кнопкой в QR
 * backoffice). Контракт получен с боевой backoffice-сессии:
 * POST /platform/data/warehouse.inventory.document.v2/action
 * body: { actionName: "process", ids: [<externalId>], data: {...list filter...} }
 * Auth — backoffice cookie (см. callQuickRestoBackOfficeData).
 *
 * QR на этом эндпоинте проводит акт (выставляет processed=true и движет
 * остатки на складе). Возвращает обновлённый response в формате list-API.
 *
 * NB: «data» (start/count/mode/timeZone) — контекст списка, QR использует его
 * для формирования ответа (re-fetch); сам action работает только по `ids`.
 * Передаём дефолты, эквивалентные «previous30Days».
 */
export async function processInventoryDocumentBackOffice(input: {
  layerName: string;
  baseUrl?: string | null;
  cookieHeader: string;
  documentId: number;
}) {
  return callQuickRestoBackOfficeData<unknown>({
    layerName: input.layerName,
    baseUrl: input.baseUrl,
    cookieHeader: input.cookieHeader,
    path: "warehouse.inventory.document.v2/action",
    query: {
      businessDayOffsetInMs: 32_400_000,
      timeZone: new Date().getTimezoneOffset(),
    },
    body: {
      actionName: "process",
      ids: [input.documentId],
      data: {
        start: 0,
        count: 150,
        mode: "previous30Days",
        timeZone: new Date().getTimezoneOffset(),
      },
    },
  });
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
