/**
 * Условия списка «Финансы → Транзакции» из адреса страницы.
 *
 * Один разбор на страницу и CSV-выгрузку: раньше у них было по своей копии,
 * и выгрузка отдавала «id1,id2» как один id — с двумя счетами или «Без
 * статьи» в фильтре она падала. Результат — ровно то, что принимает SQL-
 * функция `finance_transactions_page` (миграция 370), без дальнейших
 * преобразований.
 *
 * Модуль чистый (без React и Supabase): его импортируют сервер, клиент и
 * тесты.
 */

export type TransactionType = "income" | "expense" | "transfer";

export const TRANSACTION_SORT_FIELDS = [
  "date",
  "amount",
  "category",
  "counterparty",
  "account",
] as const;
export type TransactionSortField = (typeof TRANSACTION_SORT_FIELDS)[number];
export type TransactionSortMode = `${TransactionSortField}_${"asc" | "desc"}`;

export const TRANSACTION_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_TRANSACTION_PAGE_SIZE = 25;
/** Сортировок одновременно — столько слотов в SQL-функции. */
export const MAX_TRANSACTION_SORTS = 3;

/** Пункт «Без статьи» / «Без контрагента» в фильтре — значение в адресе. */
export const NO_CATEGORY = "__no-category__";
export const NO_COUNTERPARTY = "__no-counterparty__";
export const NO_VENUE = "__no-venue__";

/** Аргумент `p_filters` функции `finance_transactions_page`. */
export type TransactionFilters = {
  legal_entity_id?: string;
  venue_id?: string;
  /** «Без заведения». */
  venue_none?: boolean;
  bank_account_ids?: string[];
  category_ids?: string[];
  category_none?: boolean;
  counterparty_ids?: string[];
  counterparty_none?: boolean;
  type?: TransactionType;
  date_from?: string;
  date_to?: string;
  amount_min?: number;
  amount_max?: number;
  q?: string;
  /** Есть ли прикреплённые файлы (чеки, счета). */
  files?: "with" | "without";
  /** Только удалённые операции. */
  deleted?: boolean;
};

export type TransactionQuery = {
  filters: TransactionFilters;
  sort: TransactionSortMode[];
  /** С единицы. */
  page: number;
  pageSize: number;
  /** Подпись выбранного пресета периода — только для кнопки периода. */
  datePreset: string | null;
};

type Reader = (key: string) => string | null | undefined;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = new Set<TransactionType>(["income", "expense", "transfer"]);
const SORT_FIELDS = new Set<string>(TRANSACTION_SORT_FIELDS);

/** Разбирает адрес. `get` — `URLSearchParams.get` или чтение объекта searchParams. */
export function parseTransactionQuery(
  get: Reader,
  options: { allowDeleted?: boolean } = {},
): TransactionQuery {
  const filters: TransactionFilters = {};

  const type = get("type");
  if (type && TYPES.has(type as TransactionType))
    filters.type = type as TransactionType;

  const le = uuidOrNull(get("legal_entity_id"));
  if (le) filters.legal_entity_id = le;
  const venueParam = get("venue_id");
  if (venueParam === NO_VENUE) filters.venue_none = true;
  else {
    const venue = uuidOrNull(venueParam);
    if (venue) filters.venue_id = venue;
  }

  const accounts = uuidList(get("bank_account_id"));
  if (accounts.length) filters.bank_account_ids = accounts;

  const categories = splitCsv(get("category_id"));
  const categoryIds = categories.filter(isUuid);
  if (categoryIds.length) filters.category_ids = categoryIds;
  if (categories.includes(NO_CATEGORY)) filters.category_none = true;

  const counterparties = splitCsv(get("counterparty_id"));
  const counterpartyIds = counterparties.filter(isUuid);
  if (counterpartyIds.length) filters.counterparty_ids = counterpartyIds;
  if (counterparties.includes(NO_COUNTERPARTY)) filters.counterparty_none = true;

  const from = isoDateOrNull(get("date_from"));
  if (from) filters.date_from = from;
  const to = isoDateOrNull(get("date_to"));
  if (to) filters.date_to = to;

  const min = amountOrNull(get("amount_min"));
  if (min !== null) filters.amount_min = min;
  const max = amountOrNull(get("amount_max"));
  if (max !== null) filters.amount_max = max;

  const q = get("q")?.trim();
  if (q) filters.q = q.slice(0, 200);

  const files = get("files");
  if (files === "with" || files === "without") filters.files = files;

  if (options.allowDeleted && get("deleted") === "1") filters.deleted = true;

  const page = Number.parseInt(get("page") ?? "", 10);
  const size = Number.parseInt(get("size") ?? "", 10);

  return {
    filters,
    sort: parseSort(get("sort")),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: (TRANSACTION_PAGE_SIZES as readonly number[]).includes(size)
      ? size
      : DEFAULT_TRANSACTION_PAGE_SIZE,
    datePreset: filters.date_from || filters.date_to ? get("date_preset")?.slice(0, 60) || null : null,
  };
}

/** `sort=date_desc,amount_asc` → режимы по приоритету; повтор поля и мусор отбрасываются. */
export function parseSort(value: string | null | undefined): TransactionSortMode[] {
  const seen = new Set<string>();
  const out: TransactionSortMode[] = [];
  for (const part of splitCsv(value)) {
    const match = /^([a-z]+)_(asc|desc)$/.exec(part);
    if (!match || !SORT_FIELDS.has(match[1]) || seen.has(match[1])) continue;
    seen.add(match[1]);
    out.push(part as TransactionSortMode);
    if (out.length === MAX_TRANSACTION_SORTS) break;
  }
  return out;
}

/**
 * Выбраны ли условия, отбирающие строки (без поиска и режима «Удалённые»):
 * от этого зависят подсветка кнопки фильтров и видимость ряда условий.
 */
export function hasTransactionFilters(filters: TransactionFilters): boolean {
  return Boolean(
    filters.legal_entity_id ||
      filters.venue_id ||
      filters.venue_none ||
      filters.files ||
      filters.bank_account_ids?.length ||
      filters.category_ids?.length ||
      filters.category_none ||
      filters.counterparty_ids?.length ||
      filters.counterparty_none ||
      filters.type ||
      filters.date_from ||
      filters.date_to ||
      filters.amount_min !== undefined ||
      filters.amount_max !== undefined,
  );
}

function splitCsv(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isUuid(value: string): boolean {
  return UUID.test(value);
}

function uuidOrNull(value: string | null | undefined): string | null {
  return value && isUuid(value) ? value : null;
}

function uuidList(value: string | null | undefined): string[] {
  return [...new Set(splitCsv(value).filter(isUuid))];
}

/** Только настоящая календарная дата: `2026-13-40` и `foo` отбрасываются. */
export function isoDateOrNull(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
    ? value
    : null;
}

function amountOrNull(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
