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

const TABLE_SCHEME_CLASS =
  "ru.edgex.quickresto.modules.front.tablemanagement.TableScheme";
const TABLE_SCHEME_MODULE = "front.tablemanagement";

const ROLE_CLASS = "ru.edgex.platform.service.user.Role";
const ROLE_MODULE = "users.role";

const EMPLOYEE_CLASS =
  "ru.edgex.quickresto.modules.personnel.employee.Employee";
const EMPLOYEE_MODULE = "personnel.employee";

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

async function callQuickResto<T>(input: {
  layerName: string;
  login: string;
  password: string;
  path: "list" | "read";
  moduleName: string;
  className: string;
  objectId?: number;
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

  const url = `${buildBaseUrl(input.layerName)}/${input.path}?${params.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: withAuthHeader(input.login, input.password),
    cache: "no-store",
  });

  if (response.status === 401) {
    throw new Error("Quick Resto auth failed (401)");
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Quick Resto request failed: ${response.status} ${body}`);
  }

  return (await response.json()) as T;
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
