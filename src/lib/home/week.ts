import "server-only";

import {
  comparisonWindows,
  type CompareMode,
  type ComparisonWindow,
} from "@/lib/finance/dashboard-compare";
import { parseIsoDay, type DashboardPeriod } from "@/lib/finance/dashboard-period";
import { getPeriodTotals } from "@/lib/finance/statistics";
import { effectiveMetrics, type SalesDay } from "@/lib/sales/types";
import { asLooseDb } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";

import { getHomeContext } from "./context";
import { weekOf } from "./today";

export type SalesTotals = {
  turnover: number;
  /** Гостевые чеки (без Staff) у смен, где известны и оборот, и чеки. */
  guests: number;
  /** Оборот тех же смен — база среднего чека. */
  checkedTurnover: number;
  /** Смен с известным оборотом. */
  days: number;
};

export type WeekMetrics = {
  week: DashboardPeriod;
  /** По какой день считается неделя (сегодня) — для сравнения с тем же числом дней. */
  cutoff: string;
  mode: CompareMode;
  /** С чем сравниваем: «16–20 ноября», «23–27 ноября 2025». `null` — не с чем. */
  base: ComparisonWindow | null;
  /** `null` — нет права на смены продаж. */
  sales: { current: SalesTotals; base: SalesTotals | null; error: boolean } | null;
  /** `null` — нет права на операции. */
  expense: { current: number | null; base: number | null; baseCount: number; error: boolean } | null;
};

/** Видит ли человек показатели недели. */
export function canSeeWeek(permissions: Set<string>): boolean {
  return permissions.has("sales.view_shifts") || permissions.has("finance.view_transactions");
}

const emptyTotals = (): SalesTotals => ({ turnover: 0, guests: 0, checkedTurnover: 0, days: 0 });

/** Гостевые чеки смены — из сводки расчёта, как в «Сменах»; у старых смен их нет. */
function guestChecks(day: Pick<SalesDay, "source_summary">): number | null {
  const n = day.source_summary?.guest_checks;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function salesTotals(days: SalesDay[], period: DashboardPeriod): SalesTotals {
  const out = emptyTotals();
  for (const day of days) {
    if (day.business_date < period.from || day.business_date > period.to) continue;
    const turnover = effectiveMetrics(day).turnover;
    if (turnover === null) continue;
    out.turnover += turnover;
    out.days++;
    const guests = guestChecks(day);
    if (guests) {
      out.guests += guests;
      out.checkedTurnover += turnover;
    }
  }
  return out;
}

/** Средний чек гостя: оборот на гостевой чек; `null` — чеков нет. */
export function averageCheck(t: SalesTotals | null | undefined): number | null {
  return t && t.guests > 0 ? t.checkedTurnover / t.guests : null;
}

/**
 * Показатели текущей недели (понедельник — сегодня): оборот и средний чек
 * по сменам продаж заведения, расходы — по операциям финансов (те же, что
 * на финансовом дашборде без отборов). Сравнение — по такому же числу дней
 * прошлой недели или той же недели год назад, как на финансовом дашборде.
 */
export async function loadWeekMetrics(mode: CompareMode): Promise<WeekMetrics | null> {
  const ctx = await getHomeContext();
  if (!ctx) return null;
  const can = (code: string) => ctx.permissions.has(code);
  const week = weekOf(ctx.businessDay);
  const today = parseIsoDay(ctx.businessDay) ?? new Date();
  const windows = comparisonWindows(week, today);
  const cutoff = windows?.cutoff ?? week.to;
  const base = windows ? (mode === "year" ? windows.lastYear : windows.previous ?? windows.lastYear) : null;
  const current: DashboardPeriod = { from: week.from, to: cutoff };

  const loadSales = async () => {
    const db = asLooseDb(await createClient());
    const read = (period: DashboardPeriod) =>
      db
        .from<SalesDay[]>("sales_days")
        .select("business_date,calculated,overrides,source_summary")
        .eq("venue_id", ctx.venueId)
        .gte("business_date", period.from)
        .lte("business_date", period.to);
    const [now, before] = await Promise.all([read(current), base ? read(base.period) : null]);
    if (now.error || before?.error) return { current: emptyTotals(), base: null, error: true };
    return {
      current: salesTotals(now.data ?? [], current),
      base: before ? salesTotals(before.data ?? [], base!.period) : null,
      error: false,
    };
  };

  const loadExpense = async () => {
    const [now, before] = await Promise.all([
      getPeriodTotals({ date_from: current.from, date_to: current.to }),
      base ? getPeriodTotals({ date_from: base.period.from, date_to: base.period.to }) : null,
    ]);
    return {
      current: now.summary?.expense ?? null,
      base: before?.summary?.expense ?? null,
      baseCount: before?.summary?.expenseCount ?? 0,
      error: !now.summary,
    };
  };

  const [sales, expense] = await Promise.all([
    can("sales.view_shifts") ? loadSales() : null,
    can("finance.view_transactions") ? loadExpense() : null,
  ]);
  return { week, cutoff, mode, base, sales, expense };
}
