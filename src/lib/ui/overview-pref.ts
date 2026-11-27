// Открыт ли «Обзор» страницы — выбор пользователя в этом браузере.
//
// Хранится в localStorage и дублируется в cookie: страницу рисует сервер, а
// localStorage он не видит. Без cookie сервер рисовал «Обзор» открытым, и у
// того, кто его свернул, панель мелькала до загрузки скриптов, а таблица под
// ней уезжала вверх. С cookie сервер сразу рисует нужное состояние.

/** Имя cookie для ключа `payroll.overview`, `people.overview.staff`… */
export function overviewCookieName(storageKey: string) {
  return `sheerly_overview_${storageKey.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

/** Значение cookie → открыт ли «Обзор»; неизвестно — undefined. */
export function parseOverviewCookie(value: string | undefined): boolean | undefined {
  if (value === "open") return true;
  if (value === "closed") return false;
  return undefined;
}

/** Ключи выбора «Обзора» по страницам (localStorage и cookie). */
export const OVERVIEW_KEYS = {
  staff: "people.overview.staff",
  candidates: "people.overview.candidates",
  payroll: "payroll.overview",
  salesAdditional: "sales.additional.overview",
} as const;
