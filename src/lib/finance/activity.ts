import "server-only";

import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { periodRange, type DirectoryPeriod } from "@/lib/finance/period";

/**
 * Дата операции — календарный день, записанный полночью UTC. Отдаём
 * `ГГГГ-ММ-ДД`: так день не сдвигается ни на сервере, ни в браузере
 * западнее Гринвича, и сервер с браузером рисуют одно и то же.
 */
export function operationDay(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

/** Операции по статье за период: сколько, на какую сумму; последняя — на конец периода. */
export type CategoryActivity = {
  operations: number;
  lastDate: string | null;
  total: number;
};

/** Операции с контрагентом за период: поступления и выплаты отдельно. */
export type CounterpartyActivity = {
  operations: number;
  lastDate: string | null;
  incomeTotal: number;
  expenseTotal: number;
};

/**
 * Активность справочников «Финансов» за период (миграция 369; без границ —
 * всё время). Функции считают только
 * операции, которые пользователь видит в «Транзакциях», поэтому без права
 * на них не вызываются вовсе. Ошибка (например, миграция ещё не на проде) не
 * роняет страницу: возвращается `null`, и столбцы показывают «—».
 */
export async function loadCategoryActivity(
  period: DirectoryPeriod,
): Promise<Record<string, CategoryActivity> | null> {
  const db = asLooseDb(await createClient());
  const { data, error } = await db.rpc("finance_category_activity", rangeArgs(period));
  if (error) {
    console.error("[finance] category activity failed", error.message);
    return null;
  }
  const out: Record<string, CategoryActivity> = {};
  for (const row of (data ?? []) as Array<{
    category_id: string;
    operations: number | string;
    last_date: string | null;
    total: number | string | null;
  }>) {
    out[row.category_id] = {
      operations: Number(row.operations),
      lastDate: operationDay(row.last_date),
      total: Number(row.total ?? 0),
    };
  }
  return out;
}

export async function loadCounterpartyActivity(
  period: DirectoryPeriod,
): Promise<Record<string, CounterpartyActivity> | null> {
  const db = asLooseDb(await createClient());
  const { data, error } = await db.rpc("counterparty_activity", rangeArgs(period));
  if (error) {
    console.error("[finance] counterparty activity failed", error.message);
    return null;
  }
  const out: Record<string, CounterpartyActivity> = {};
  for (const row of (data ?? []) as Array<{
    counterparty_id: string;
    operations: number | string;
    last_date: string | null;
    income_total: number | string | null;
    expense_total: number | string | null;
  }>) {
    out[row.counterparty_id] = {
      operations: Number(row.operations),
      lastDate: operationDay(row.last_date),
      incomeTotal: Number(row.income_total ?? 0),
      expenseTotal: Number(row.expense_total ?? 0),
    };
  }
  return out;
}

function rangeArgs(period: DirectoryPeriod) {
  const { from, to } = periodRange(period);
  return { p_from: from, p_to: to };
}
