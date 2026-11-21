import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import type {
  TransactionFilters,
  TransactionSortMode,
} from "@/lib/finance/transaction-query";
import type { TransactionRow } from "@/types/finance";

// Не "use server": модуль не становится действием, которое можно вызвать из
// браузера. Его зовут страница (через ограниченный `queryTransactions`) и
// выгрузка CSV — после проверки права finance.export.

export type QueryTransactionsOptions = {
  filters?: TransactionFilters;
  sort?: TransactionSortMode[];
  /** 1-based page number. */
  page?: number;
  /** Page size (the SQL function clamps it to 1..10000). */
  pageSize?: number;
};

export type QueryTransactionsResult = {
  rows: TransactionRow[];
  /** Rows matching the conditions. */
  total: number;
  /** Sums over all matching rows (not only this page); transfers excluded. */
  income: number;
  expense: number;
  /** Currencies of the matching rows: totals in several currencies aren't summed. */
  currencies: string[];
  /** Non-deleted rows of the section without conditions — «N из M». */
  allTotal: number;
  /** Soft-deleted rows visible to the user (only with finance.delete_transaction). */
  deletedTotal: number;
  error: string | null;
};

/**
 * List page, totals and counters in one call to `finance_transactions_page`
 * (migration 369). Filters, search and sorting live in SQL so the table, the
 * totals row and the CSV export can't disagree. SECURITY INVOKER — RLS
 * `transactions_select` scopes rows (account, legal entity, venue, deleted).
 */
export async function fetchTransactionsPage(
  opts: QueryTransactionsOptions = {},
): Promise<QueryTransactionsResult> {
  const supabase = await createClient();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.max(1, opts.pageSize ?? 25);
  const { data, error } = await asLooseDb(supabase).rpc(
    "finance_transactions_page",
    {
      p_filters: opts.filters ?? {},
      p_sort: opts.sort ?? [],
      p_limit: pageSize,
      p_offset: (page - 1) * pageSize,
    },
  );
  if (error || !data) {
    return {
      rows: [],
      total: 0,
      income: 0,
      expense: 0,
      currencies: [],
      allTotal: 0,
      deletedTotal: 0,
      error: error?.message ?? "Не удалось загрузить операции",
    };
  }
  const result = data as {
    rows: TransactionRow[];
    total: number;
    income: number | string;
    expense: number | string;
    currencies?: string[];
    all_total: number;
    deleted_total: number;
  };
  return {
    rows: result.rows ?? [],
    total: Number(result.total ?? 0),
    income: Number(result.income ?? 0),
    expense: Number(result.expense ?? 0),
    currencies: result.currencies ?? [],
    allTotal: Number(result.all_total ?? 0),
    deletedTotal: Number(result.deleted_total ?? 0),
    error: null,
  };
}
