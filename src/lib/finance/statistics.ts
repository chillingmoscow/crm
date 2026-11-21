import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { LooseQuery } from "@/lib/supabase/loose";
import type { BankAccountRow, TransactionRow } from "@/types/finance";

import {
  aggregateFlow,
  type FlowBreakdown,
  type FlowRow,
  type FlowSummary,
} from "./dashboard-flow";
import {
  calendarDateInZone,
  dayEndExclusiveInZone,
  dayStartInZone,
} from "@/lib/format/zoned-day";
import { getActiveAccountTimezone } from "@/lib/settings/account";

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

/**
 * Границы периода — дни в поясе аккаунта (`accounts.timezone`), как в
 * «Транзакциях» (`finance_transactions_page`): иначе итоги дашборда и списка
 * за тот же период расходились бы на ночных выплатах.
 */
type ZonedRange = StatisticsRange & { timeZone: string };

async function zoned(range: StatisticsRange): Promise<ZonedRange> {
  return { ...range, timeZone: await getActiveAccountTimezone() };
}

function applyRange<T>(query: Filterable<T>, range: ZonedRange): Filterable<T> {
  // `transactions.date` — timestamptz. Граница «по» включительно — это
  // «раньше начала следующего дня»: `lte('2026-11-30')` сравнивал бы с
  // полуночью 30-го и терял операции этого дня с временем.
  let q = query
    .gte("date", dayStartInZone(range.date_from, range.timeZone))
    .lt("date", dayEndExclusiveInZone(range.date_to, range.timeZone));
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

type DatedFlowRow = FlowRow & { date: string };

/** Операции периода без переводов — все страницы, а не первая тысяча. */
async function fetchFlowRows<T>(range: ZonedRange, columns: string): Promise<T[]> {
  const supabase = await createClient();
  return fetchAllRows<T>(() =>
    applyRange(
      supabase
        .from("transactions")
        .select(columns)
        .is("deleted_at", null)
        .neq("type", "transfer") as unknown as Filterable<T[]>,
      range,
    ),
  );
}

/**
 * Доходы, расходы и расходы по статьям за период. Читает все операции
 * периода постранично: PostgREST отдаёт не больше 1000 строк и молча
 * обрезает остальное — за год сумма «Расходов» была бы неполной.
 *
 * `cutoff` — последний прошедший день идущего периода: `elapsed` тогда
 * считает итоги только по него, чтобы сравнивать с прошлым периодом по
 * одинаковому числу дней. Операции, заведённые вперёд датой после
 * сегодняшней, в сравнение не попадают.
 */
export async function getPeriodFlow(
  range: StatisticsRange,
  topN = 5,
  cutoff: string | null = null,
): Promise<{ flow: FlowBreakdown | null; elapsed: FlowSummary | null; error: string | null }> {
  try {
    const zonedRange = await zoned(range);
    const rows = await fetchFlowRows<DatedFlowRow>(zonedRange, "type, amount, category_id, date");
    const flow = aggregateFlow(rows, topN);
    // Календарный день операции — в поясе аккаунта (у выплат дата с часами).
    const elapsed = cutoff
      ? aggregateFlow(
          rows.filter((r) => calendarDateInZone(r.date, zonedRange.timeZone) <= cutoff),
          0,
        ).summary
      : flow.summary;
    return { flow, elapsed, error: null };
  } catch (e) {
    return { flow: null, elapsed: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Только итоги периода — для сравнения с прошлым периодом и годом назад. */
export async function getPeriodTotals(
  range: StatisticsRange,
): Promise<{ summary: FlowSummary | null; error: string | null }> {
  try {
    const rows = await fetchFlowRows<Omit<FlowRow, "category_id">>(await zoned(range), "type, amount");
    return {
      summary: aggregateFlow(rows.map((r) => ({ ...r, category_id: null })), 0).summary,
      error: null,
    };
  } catch (e) {
    return { summary: null, error: e instanceof Error ? e.message : String(e) };
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
  const zonedRange = await zoned(range);
  const query = applyRange(
    supabase
      .from("transactions")
      .select(
        "id, type, amount, date, description, bank_account_id, to_bank_account_id, category_id, counterparty_id",
      )
      .is("deleted_at", null) as unknown as Filterable<RecentTransaction[]>,
    zonedRange,
  );
  const { data, error } = await query
    .order("date", { ascending: false })
    .order("public_id", { ascending: false })
    .limit(Math.max(1, Math.min(50, limit)));
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as RecentTransaction[], error: null };
}
