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
   * Прогноз на конец месяца по темпу закрытых смен. Только у текущего месяца
   * и только когда закрыто не меньше `FORECAST_MIN_SHIFTS` смен с оборотом.
   */
  forecast: {
    value: number;
    ratio: number;
    /** Средний оборот закрытой смены. */
    pace: number;
    /** Закрытых смен с оборотом. */
    shifts: number;
    /** Сколько смен ещё ждём до конца месяца, включая текущую. */
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
 * Темп считается по сменам, а не по календарным дням: средний оборот закрытой
 * смены × смены, которые ещё будут. Сколько смен ещё будет, берём из того, как
 * заведение работало в этом месяце: доля дней со сменой среди прошедших дней,
 * применённая к оставшимся (включая сегодняшний). Заведение без выходных —
 * каждый оставшийся день; с выходными — пропорционально меньше.
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
  // Закрытая смена — завершённая (или перенесённая из архива) и до сегодняшней.
  const closed = monthDays.filter(
    (d) => d.status !== "preliminary" && d.business_date < today && turnover(d) !== null,
  );
  const base = {
    plan,
    fact,
    ratio: fact === null ? null : fact / plan,
    phase,
    closedShifts: closed.length,
  } as const;
  if (phase !== "current" || closed.length < FORECAST_MIN_SHIFTS)
    return { ...base, forecast: null };
  const closedSum = closed.reduce((s, d) => s + turnover(d)!, 0);
  const pace = closedSum / closed.length;
  const elapsed = Number(today.slice(8, 10)) - 1; // дней месяца до сегодняшнего
  const left = daysInMonth(month) - elapsed; // сегодня и после
  const workShare = elapsed > 0 ? Math.min(1, closed.length / elapsed) : 1;
  const remaining = Math.round(left * workShare);
  const value = round(closedSum + pace * remaining);
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
