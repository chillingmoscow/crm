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
import { addDaysIso, weekOf } from "./today";

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
  /**
   * По какой день считается неделя — по вчерашний: сегодняшняя смена ещё
   * идёт, и её оборот против полного дня прошлой недели дал бы «−90%».
   */
  cutoff: string;
  /** `false` — понедельник, закрытых дней ещё нет: показатели не считаем. */
  started: boolean;
  /** Активное заведение — для ссылки на операции с тем же отбором. */
  venueId: string;
  mode: CompareMode;
  /** С чем сравниваем: «16–20 ноября», «23–27 ноября 2025». `null` — не с чем. */
  base: ComparisonWindow | null;
  /** `null` — нет права на смены продаж. */
  sales: { current: SalesTotals; base: SalesTotals | null; error: boolean } | null;
  /** `null` — нет права на операции. */
  expense: {
    current: number | null;
    base: number | null;
    baseCount: number;
    error: boolean;
    /** Базу сравнения загрузить не удалось — не путать с «данных не было». */
    baseError: boolean;
  } | null;
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
 * Показатели текущей недели по закрытым дням (понедельник — вчера): оборот и
 * средний чек по сменам продаж заведения, расходы — по операциям финансов
 * того же заведения. Сравнение — по такому же числу дней прошлой недели или
 * той же недели год назад, как на финансовом дашборде.
 */
export async function loadWeekMetrics(mode: CompareMode): Promise<WeekMetrics | null> {
  const ctx = await getHomeContext();
  if (!ctx) return null;
  const can = (code: string) => ctx.permissions.has(code);
  const week = weekOf(ctx.businessDay);
  const yesterday = addDaysIso(ctx.businessDay, -1);
  const started = yesterday >= week.from;
  if (!started)
    // Блок показывает те же показатели, что и в другие дни, но без чисел.
    return {
      week,
      cutoff: yesterday,
      started,
      venueId: ctx.venueId,
      mode,
      base: null,
      sales: can("sales.view_shifts") ? { current: emptyTotals(), base: null, error: false } : null,
      expense: can("finance.view_transactions")
        ? { current: null, base: null, baseCount: 0, error: false, baseError: false }
        : null,
    };
  const windows = comparisonWindows(week, parseIsoDay(yesterday) ?? new Date());
  const cutoff = windows?.cutoff ?? yesterday;
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
    const venue = { venue_id: ctx.venueId };
    const [now, before] = await Promise.all([
      getPeriodTotals({ date_from: current.from, date_to: current.to, ...venue }),
      base ? getPeriodTotals({ date_from: base.period.from, date_to: base.period.to, ...venue }) : null,
    ]);
    return {
      current: now.summary?.expense ?? null,
      base: before?.summary?.expense ?? null,
      baseCount: before?.summary?.expenseCount ?? 0,
      error: !now.summary,
      baseError: !!before && !before.summary,
    };
  };

  const [sales, expense] = await Promise.all([
    can("sales.view_shifts") ? loadSales() : null,
    can("finance.view_transactions") ? loadExpense() : null,
  ]);
  return { week, cutoff, started, venueId: ctx.venueId, mode, base, sales, expense };
}
