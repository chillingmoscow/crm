import "server-only";

import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";

/**
 * Дата операции — календарный день, записанный полночью UTC. Отдаём
 * `ГГГГ-ММ-ДД`: так день не сдвигается ни на сервере, ни в браузере
 * западнее Гринвича, и сервер с браузером рисуют одно и то же.
 */
export function operationDay(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

/** Операции по статье: сколько, когда последняя, на какую сумму. */
export type CategoryActivity = {
  operations: number;
  lastDate: string | null;
  total: number;
};

/** Операции с контрагентом: поступления и выплаты отдельно. */
export type CounterpartyActivity = {
  operations: number;
  lastDate: string | null;
  incomeTotal: number;
  expenseTotal: number;
};

/**
 * Активность справочников «Финансов» (миграция 369). Функции считают только
 * операции, которые пользователь видит в «Транзакциях», поэтому без права
 * на них не вызываются вовсе. Ошибка (например, миграция ещё не на проде) не
 * роняет страницу: возвращается `null`, и столбцы показывают «—».
 */
export async function loadCategoryActivity(): Promise<Record<string, CategoryActivity> | null> {
  const db = asLooseDb(await createClient());
  const { data, error } = await db.rpc("finance_category_activity");
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

export async function loadCounterpartyActivity(): Promise<Record<string, CounterpartyActivity> | null> {
  const db = asLooseDb(await createClient());
  const { data, error } = await db.rpc("counterparty_activity");
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
