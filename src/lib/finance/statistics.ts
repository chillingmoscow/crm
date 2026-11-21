import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { LooseQuery } from "@/lib/supabase/loose";
import type { BankAccountRow, TransactionRow } from "@/types/finance";

import { aggregateFlow, type FlowBreakdown, type FlowRow } from "./dashboard-flow";
import { nextIsoDay } from "./dashboard-period";

/**
 * Чтение для финансового дашборда. Только сервер: это не server actions
 * (раньше файл был `"use server"`, и каждая функция открывалась наружу как
 * action), а запросы для RSC. RLS по-прежнему решает, какие строки видны.
 */

export type StatisticsRange = {
  /** Первый день периода `YYYY-MM-DD`, включительно. */
  date_from: string;
  /** Последний день периода `YYYY-MM-DD`, включительно. */
  date_to: string;
  /** Одно юрлицо (выбор юрлица в финансах). */
  legal_entity_id?: string | null;
  /** Одно заведение. */
  venue_id?: string | null;
};

type Filterable<T> = LooseQuery<T>;

function applyRange<T>(query: Filterable<T>, range: StatisticsRange): Filterable<T> {
  // `transactions.date` — timestamptz. Граница «по» включительно — это
  // «раньше следующего дня»: `lte('2026-11-30')` сравнивал бы с полуночью
  // 30-го и терял операции этого дня с временем.
  let q = query.gte("date", range.date_from).lt("date", nextIsoDay(range.date_to));
  if (range.legal_entity_id) q = q.eq("legal_entity_id", range.legal_entity_id);
  if (range.venue_id) q = q.eq("venue_id", range.venue_id);
  return q;
}

// ─── Остатки на счетах ──────────────────────────────────────────────────────

export type BalanceAccount = Pick<
  BankAccountRow,
  "id" | "name" | "type" | "legal_entity_id" | "balance" | "currency"
>;

/**
 * Счета, которые входят в общий остаток: не удалены и не исключены из
 * баланса. Сумма их `balance` — показатель «На счетах».
 */
export async function listBalanceAccounts(
  opts: { legal_entity_id?: string | null } = {},
): Promise<{ rows: BalanceAccount[]; error: string | null }> {
  const supabase = await createClient();
  let query = supabase
    .from("bank_accounts")
    .select("id, name, type, legal_entity_id, balance, currency")
    .eq("excluded_from_balance", false)
    .is("deleted_at", null);
  if (opts.legal_entity_id) query = query.eq("legal_entity_id", opts.legal_entity_id);
  const { data, error } = await query.order("balance", { ascending: false });
  if (error) return { rows: [], error: error.message };
  return {
    rows: ((data ?? []) as BalanceAccount[]).map((r) => ({ ...r, balance: Number(r.balance) })),
    error: null,
  };
}

// ─── Поток за период ────────────────────────────────────────────────────────

/**
 * Доходы, расходы и расходы по статьям за период. Читает все операции
 * периода постранично: PostgREST отдаёт не больше 1000 строк и молча
 * обрезает остальное — за год сумма «Расходов» была бы неполной.
 */
export async function getPeriodFlow(
  range: StatisticsRange,
  topN = 5,
): Promise<{ flow: FlowBreakdown | null; error: string | null }> {
  const supabase = await createClient();
  try {
    const rows = await fetchAllRows<FlowRow>(() =>
      applyRange(
        supabase
          .from("transactions")
          .select("type, amount, category_id")
          .is("deleted_at", null)
          .neq("type", "transfer") as unknown as Filterable<FlowRow[]>,
        range,
      ),
    );
    return { flow: aggregateFlow(rows, topN), error: null };
  } catch (e) {
    return { flow: null, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Последние операции ─────────────────────────────────────────────────────

export type RecentTransaction = Pick<
  TransactionRow,
  | "id"
  | "type"
  | "amount"
  | "date"
  | "description"
  | "bank_account_id"
  | "to_bank_account_id"
  | "category_id"
  | "counterparty_id"
>;

/** Последние операции периода — сначала новые. */
export async function getRecentTransactions(
  range: StatisticsRange,
  limit = 8,
): Promise<{ rows: RecentTransaction[]; error: string | null }> {
  const supabase = await createClient();
  const query = applyRange(
    supabase
      .from("transactions")
      .select(
        "id, type, amount, date, description, bank_account_id, to_bank_account_id, category_id, counterparty_id",
      )
      .is("deleted_at", null) as unknown as Filterable<RecentTransaction[]>,
    range,
  );
  const { data, error } = await query
    .order("date", { ascending: false })
    .order("public_id", { ascending: false })
    .limit(Math.max(1, Math.min(50, limit)));
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as RecentTransaction[], error: null };
}
