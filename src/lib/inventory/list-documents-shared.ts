/**
 * Pure helpers and shared types for list-documents.ts.
 * Held in a separate file без импортов из `@/...`, чтобы node:test
 * мог импортировать напрямую (тест-раннер не резолвит alias из tsconfig).
 */

export type DocumentSortMode =
  | "date_desc"
  | "date_asc"
  | "number_desc"
  | "number_asc"
  | "status_desc"
  | "status_asc";

export const DOCUMENT_SORT_MODES = [
  "date_desc",
  "date_asc",
  "number_desc",
  "number_asc",
  "status_desc",
  "status_asc",
] as const satisfies readonly DocumentSortMode[];

/** Дефолтная сортировка — единственный ключ date_desc. */
export const DEFAULT_SORT: DocumentSortMode[] = ["date_desc"];

export function isDefaultSort(sort: DocumentSortMode[]): boolean {
  return sort.length === 1 && sort[0] === DEFAULT_SORT[0];
}

export const DOCUMENT_STATUSES = [
  "synced",
  "assigned",
  "in_progress",
  "ready_for_review",
  "processed",
  "results_blocked",
  "sync_error",
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export type AssignedFilter = "any" | "none" | "me" | string;

export type ListDocumentsFilters = {
  /** venue uuid as string, 'unassigned' sentinel, 'all', or undefined. */
  venue?: string;
  status?: DocumentStatus[];
  /** 'any' | 'none' | 'me' | concrete user uuid. */
  assigned?: AssignedFilter;
  store?: string[];
  date_from?: string;
  date_to?: string;
  q?: string;
};

export type DocumentListRow = {
  id: string;
  document_number: string;
  invoice_date: string | null;
  status: string;
  processed: boolean;
  assigned_to: string | null;
  shortfall_sum: number | null;
  surplus_sum: number | null;
  results_has_line_amounts: boolean;
  store_id: string | null;
  store_title: string | null;
  venue_id: string | null;
  comment: string | null;
  matched_ingredients: string[] | null;
};

export type ListDocumentsResult = {
  rows: DocumentListRow[];
  total: number;
  page: number;
  pageSize: number;
  error: string | null;
};

export type ListDocumentsOptions = {
  filters?: ListDocumentsFilters;
  /** Multi-key sort. Default = ['date_desc']. */
  sort?: DocumentSortMode[];
  /** 1-based page. */
  page?: number;
  /** Page size, clamped to 1..200. */
  pageSize?: number;
};

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

type RpcRow = DocumentListRow & { total: number | string };

export type NormalizedListOptions = {
  filters: ListDocumentsFilters;
  sort: DocumentSortMode[];
  page: number;
  pageSize: number;
};

export function normalizeListOptions(opts: ListDocumentsOptions = {}): NormalizedListOptions {
  const filters = opts.filters ?? {};
  const sort = opts.sort && opts.sort.length > 0 ? opts.sort : DEFAULT_SORT;
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE));
  return { filters, sort, page, pageSize };
}

export function buildRpcArgs(opts: NormalizedListOptions): Record<string, unknown> {
  const { filters, sort, page, pageSize } = opts;
  return {
    p_filter_venue: filters.venue ?? null,
    p_filter_status: filters.status && filters.status.length > 0 ? filters.status : null,
    p_filter_assigned: filters.assigned ?? null,
    p_filter_store: filters.store && filters.store.length > 0 ? filters.store : null,
    p_filter_date_from: filters.date_from ?? null,
    p_filter_date_to: filters.date_to ?? null,
    p_filter_q: filters.q ?? null,
    p_sort: sort,
    p_page: page,
    p_page_size: pageSize,
  };
}

export function parseRpcResponse(data: unknown): { rows: DocumentListRow[]; total: number } {
  const rows = (data as RpcRow[] | null) ?? [];
  if (rows.length === 0) {
    return { rows: [], total: 0 };
  }
  const total = Number(rows[0].total) || 0;
  const cleanRows: DocumentListRow[] = rows.map((row) => ({
    id: row.id,
    document_number: row.document_number,
    invoice_date: row.invoice_date,
    status: row.status,
    processed: row.processed,
    assigned_to: row.assigned_to,
    shortfall_sum: row.shortfall_sum,
    surplus_sum: row.surplus_sum,
    results_has_line_amounts: row.results_has_line_amounts,
    store_id: row.store_id,
    store_title: row.store_title,
    venue_id: row.venue_id,
    comment: row.comment,
    matched_ingredients: row.matched_ingredients,
  }));
  return { rows: cleanRows, total };
}
