"use server";

import { createClient } from "@/lib/supabase/server";
import type { TransactionRow } from "@/types/finance";

// ─── Inputs ─────────────────────────────────────────────────────────────────

export type StatisticsRange = {
  /** ISO date (inclusive) — applied to transactions.date. */
  date_from?: string;
  /** ISO date (inclusive). */
  date_to?: string;
  /** Restrict to a single legal entity. */
  legal_entity_id?: string;
  /** Restrict to a single venue. */
  venue_id?: string;
};

// ─── 1. Balance per legal entity ─────────────────────────────────────────────

export type BalanceByLegalEntityRow = {
  legal_entity_id: string;
  /** Sum of bank_accounts.balance scoped to one legal entity. */
  balance: number;
};

/**
 * Aggregate sum(bank_accounts.balance) grouped by legal_entity_id, for
 * non-deleted accounts in the active account. Used on the finance
 * dashboard left rail.
 */
export async function getBalanceByLegalEntity(): Promise<{
  rows: BalanceByLegalEntityRow[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bank_accounts")
    .select("legal_entity_id, balance")
    .is("deleted_at", null);
  if (error) return { rows: [], error: error.message };

  const sums = new Map<string, number>();
  for (const row of (data ?? []) as { legal_entity_id: string; balance: number }[]) {
    sums.set(row.legal_entity_id, (sums.get(row.legal_entity_id) ?? 0) + Number(row.balance));
  }
  const rows: BalanceByLegalEntityRow[] = [];
  for (const [legal_entity_id, balance] of sums) {
    rows.push({ legal_entity_id, balance });
  }
  return { rows, error: null };
}

// ─── 2. Income / expense / net for a period ──────────────────────────────────

export type IncomeExpenseSummary = {
  income:  number;
  expense: number;
  /** income - expense */
  net:     number;
  /** Number of non-deleted transactions in the period. */
  count:   number;
};

/**
 * Sum income vs expense over the requested range. Transfers don't count
 * — they don't affect P&L. Soft-deleted rows are excluded.
 */
export async function getIncomeExpenseSummary(
  range: StatisticsRange = {}
): Promise<{ summary: IncomeExpenseSummary; error: string | null }> {
  const supabase = await createClient();
  let query = supabase
    .from("transactions")
    .select("type, amount")
    .is("deleted_at", null)
    .neq("type", "transfer");

  if (range.date_from)       query = query.gte("date", range.date_from);
  if (range.date_to)         query = query.lte("date", range.date_to);
  if (range.legal_entity_id) query = query.eq("legal_entity_id", range.legal_entity_id);
  if (range.venue_id)        query = query.eq("venue_id", range.venue_id);

  const { data, error } = await query;
  if (error) {
    return {
      summary: { income: 0, expense: 0, net: 0, count: 0 },
      error: error.message,
    };
  }
  let income = 0;
  let expense = 0;
  for (const row of (data ?? []) as { type: TransactionRow["type"]; amount: number }[]) {
    if (row.type === "income")  income  += Number(row.amount);
    if (row.type === "expense") expense += Number(row.amount);
  }
  return {
    summary: {
      income,
      expense,
      net: income - expense,
      count: (data ?? []).length,
    },
    error: null,
  };
}

// ─── 3. Top N expense categories ─────────────────────────────────────────────

export type TopExpenseCategoryRow = {
  category_id: string | null;
  amount: number;
  count: number;
};

/**
 * Sum expense transactions per category over the range. NULL category
 * (uncategorised) is reported as a single bucket with category_id=null.
 * Sorted by amount desc, top `limit` returned.
 */
export async function getTopExpenseCategories(
  range: StatisticsRange = {},
  limit = 5
): Promise<{ rows: TopExpenseCategoryRow[]; error: string | null }> {
  const supabase = await createClient();
  let query = supabase
    .from("transactions")
    .select("category_id, amount")
    .is("deleted_at", null)
    .eq("type", "expense");

  if (range.date_from)       query = query.gte("date", range.date_from);
  if (range.date_to)         query = query.lte("date", range.date_to);
  if (range.legal_entity_id) query = query.eq("legal_entity_id", range.legal_entity_id);
  if (range.venue_id)        query = query.eq("venue_id", range.venue_id);

  const { data, error } = await query;
  if (error) return { rows: [], error: error.message };

  const buckets = new Map<string | null, { amount: number; count: number }>();
  for (const row of (data ?? []) as { category_id: string | null; amount: number }[]) {
    const key = row.category_id;
    const cur = buckets.get(key) ?? { amount: 0, count: 0 };
    cur.amount += Number(row.amount);
    cur.count  += 1;
    buckets.set(key, cur);
  }
  const all: TopExpenseCategoryRow[] = [];
  for (const [category_id, agg] of buckets) {
    all.push({ category_id, amount: agg.amount, count: agg.count });
  }
  all.sort((a, b) => b.amount - a.amount);
  return { rows: all.slice(0, Math.max(1, limit)), error: null };
}

// ─── 4. Recent transactions ──────────────────────────────────────────────────

/**
 * Last N non-deleted transactions in the active account, ordered by
 * date desc. Used for the dashboard activity widget.
 */
export async function getRecentTransactions(
  limit = 10
): Promise<{ rows: TransactionRow[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .is("deleted_at", null)
    .order("date", { ascending: false })
    .order("public_id", { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as TransactionRow[], error: null };
}
