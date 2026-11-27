import { effectiveMetrics, type SalesDay } from "./types.ts";

/** План продаж заведения на месяц («2026-11»): оборот, к которому идут. */
export type SalesPlan = { month: string; turnover: number; updatedAt: string };

/** Прогноз появляется, когда закрыто столько смен: по одной-двум темп случаен. */
export const FORECAST_MIN_SHIFTS = 3;

export type PlanProgress = {
  plan: number;
  /** Оборот месяца на сейчас, включая идущую смену; `null` — оборота ещё нет. */
  fact: number | null;
  /** Доля плана: 0.74 — 74 %. Больше 1 — план перевыполнен. */
  ratio: number | null;
  /** Месяц прошёл, идёт или ещё не начался — относительно текущего рабочего дня. */
  phase: "past" | "current" | "future";
  /**
   * Прогноз на конец месяца: факт + темп закрытых смен × смены впереди. Только у текущего месяца
   * и только когда закрыто не меньше `FORECAST_MIN_SHIFTS` смен с оборотом.
   */
  forecast: {
    value: number;
    ratio: number;
    /** Средний оборот закрытой смены. */
    pace: number;
    /** Закрытых смен с оборотом. */
    shifts: number;
    /** Сколько смен ещё ждём до конца месяца — сверх уже начатых (сегодняшняя с оборотом входит в факт). */
    remaining: number;
  } | null;
  /** Закрытых смен с оборотом — для подписи «Прогноз появится после трёх смен». */
  closedShifts: number;
};

const daysInMonth = (month: string) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Оборот к плану и прогноз на конец месяца.
 *
 * Прогноз = оборот на сейчас (включая сегодняшнюю смену, если она уже есть) +
 * средний оборот закрытой смены × смены, которые ещё будут. Темп — по сменам,
 * а не по календарным дням. Сколько смен ещё будет, берём из того, как
 * заведение работало в этом месяце: доля прошедших дней со сменой (любой, в
 * том числе ещё не закрытой), применённая к дням после сегодняшнего — и к
 * сегодняшнему, если смены сегодня ещё нет. Прогноз не бывает меньше факта.
 */
export function planProgress(input: {
  plan: number;
  month: string;
  /** Текущий рабочий день заведения «2026-11-27». */
  today: string;
  days: Pick<SalesDay, "business_date" | "status" | "calculated" | "overrides">[];
}): PlanProgress {
  const { plan, month, today } = input;
  const monthDays = input.days.filter((d) => d.business_date.startsWith(month));
  const turnover = (d: (typeof monthDays)[number]) => {
    const v = effectiveMetrics(d).turnover;
    return v !== null && Number.isFinite(v) ? v : null;
  };
  const known = monthDays.map(turnover).filter((v): v is number => v !== null);
  const fact = known.length ? round(known.reduce((s, v) => s + v, 0)) : null;
  const phase =
    month < today.slice(0, 7) ? "past" : month > today.slice(0, 7) ? "future" : "current";
  const before = monthDays.filter((d) => d.business_date < today && turnover(d) !== null);
  // Закрытая смена — завершённая (или перенесённая из архива) и до сегодняшней.
  const closed = before.filter((d) => d.status !== "preliminary");
  const base = {
    plan,
    fact,
    ratio: fact === null ? null : fact / plan,
    phase,
    closedShifts: closed.length,
  } as const;
  if (phase !== "current" || fact === null || closed.length < FORECAST_MIN_SHIFTS)
    return { ...base, forecast: null };
  const pace = closed.reduce((s, d) => s + turnover(d)!, 0) / closed.length;
  const day = Number(today.slice(8, 10));
  const elapsed = day - 1; // дней месяца до сегодняшнего
  // Работали — был оборот, даже если смену ещё не закрыли: незакрытая
  // вчерашняя смена не должна занижать, сколько смен ждём впереди.
  const workShare = elapsed > 0 ? Math.min(1, new Set(before.map((d) => d.business_date)).size / elapsed) : 1;
  const hasToday = monthDays.some((d) => d.business_date === today && turnover(d) !== null);
  const ahead = daysInMonth(month) - day + (hasToday ? 0 : 1);
  const remaining = Math.round(ahead * workShare);
  const value = round(Math.max(fact, fact + pace * remaining));
  return {
    ...base,
    forecast: {
      value,
      ratio: value / plan,
      pace: round(pace),
      shifts: closed.length,
      remaining,
    },
  };
}
