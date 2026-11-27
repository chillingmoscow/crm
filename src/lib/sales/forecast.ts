// Прогноз плана месяца (дизайн 2026-11-27-sales-plan-forecast-kpi-v2): несколько
// независимых оценок — год к году, месяц к месяцу, по уровню последних месяцев —
// и взвешенный итог. Каждая оценка несёт текст основания: прогноз не «чёрный ящик».
// Чистые функции — их гоняет node --test.

export type MonthKey = string; // "YYYY-MM-01"
export type PriceChange = { date: string; percent: number };
/** 12 индексов, январь…декабрь, на день: средний оборот дня месяца к среднему дню года. */
export type SeasonIndex = number[];
export type ForecastEstimate = { key: "yoy" | "mom" | "level"; value: number; weight: number; basis: string };
export type Forecast = { value: number | null; estimates: ForecastEstimate[]; diverge: boolean };

export const FORECAST_WEIGHTS = {
  turnover: { yoy: 0.5, mom: 0.3, level: 0.2 },
  share: { yoy: 0.6, mom: 0.4 },
} as const;
/** Оценки, разошедшиеся больше чем на эту долю итога, помечаются. */
export const FORECAST_DIVERGENCE = 0.15;

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const label = (m: MonthKey) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const mln = (n: number) => `${(n / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} млн`;
const ratio = (n: number) => `×${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}`;

export function shiftMonth(month: MonthKey, by: number): MonthKey {
  const d = new Date(`${month.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 10);
}
const daysIn = (m: MonthKey) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();

/** Уровень цен месяца: подъём внутри месяца действует с его даты — по доле дней. */
export function priceLevel(changes: PriceChange[], month: MonthKey): number {
  const start = month.slice(0, 10);
  const days = daysIn(start);
  const end = `${start.slice(0, 8)}${String(days).padStart(2, "0")}`;
  return changes.reduce((level, c) => {
    if (c.date > end) return level;
    const f = c.date <= start ? 1 : (days - Number(c.date.slice(8, 10)) + 1) / days;
    return level * (1 + c.percent / 100) ** f;
  }, 1);
}

/** Сумма весов дней недели за месяц; weekdayWeights[0] — понедельник. */
export function monthWeight(weekdayWeights: number[], month: MonthKey): number {
  let sum = 0;
  for (let d = 1; d <= daysIn(month); d++) {
    const weekday = (new Date(`${month.slice(0, 8)}${String(d).padStart(2, "0")}T12:00:00Z`).getUTCDay() + 6) % 7;
    sum += weekdayWeights[weekday] ?? 1;
  }
  return sum;
}

const season = (index: SeasonIndex, m: MonthKey) => index[Number(m.slice(5, 7)) - 1] || 1;

function combine(estimates: Omit<ForecastEstimate, "weight">[], weights: Record<string, number>, round: (n: number) => number): Forecast {
  if (!estimates.length) return { value: null, estimates: [], diverge: false };
  const total = estimates.reduce((s, e) => s + weights[e.key], 0);
  const weighted = estimates.map((e) => ({ ...e, weight: Math.round((weights[e.key] / total) * 100) / 100 }));
  const raw = weighted.reduce((s, e) => s + e.value * (weights[e.key] / total), 0);
  const values = weighted.map((e) => e.value);
  const diverge = values.length > 1 && raw > 0 && (Math.max(...values) - Math.min(...values)) / raw > FORECAST_DIVERGENCE;
  return { value: round(raw), estimates: weighted, diverge };
}

/**
 * Прогноз оборота на месяц `target`. База — только полные месяцы (`complete`);
 * каждая база приводится к ценам целевого месяца и к «весу» его дней недели.
 */
export function forecastTurnover(input: {
  target: MonthKey;
  turnover: Map<MonthKey, number>;
  complete: Set<MonthKey>;
  prices: PriceChange[];
  season: SeasonIndex;
  weekdayWeights: number[];
}): Forecast {
  const { target, turnover, complete, prices, weekdayWeights } = input;
  const targetLevel = priceLevel(prices, target);
  const targetWeight = monthWeight(weekdayWeights, target);
  /** Оборот базы в ценах целевого месяца на единицу «веса» дней. */
  const z = (m: MonthKey): number | null => {
    const r = turnover.get(m);
    if (r == null || !complete.has(m) || r <= 0) return null;
    return (r * targetLevel) / priceLevel(prices, m) / monthWeight(weekdayWeights, m);
  };
  const S = (m: MonthKey) => season(input.season, m);
  const estimates: Omit<ForecastEstimate, "weight">[] = [];

  const lastYear = z(shiftMonth(target, -12));
  const recent = [1, 2, 3].map((k) => z(shiftMonth(target, -k)));
  const recentLastYear = [1, 2, 3].map((k) => z(shiftMonth(target, -12 - k)));
  if (lastYear !== null && recent.every((v) => v !== null) && recentLastYear.every((v) => v !== null)) {
    const trend = recent.reduce((s, v) => s + v!, 0) / recentLastYear.reduce((s, v) => s + v!, 0);
    estimates.push({
      key: "yoy",
      value: lastYear * trend * targetWeight,
      basis: `${label(shiftMonth(target, -12))}: ${mln(turnover.get(shiftMonth(target, -12))!)} · темп последних трёх месяцев к прошлому году ${ratio(trend)}`,
    });
  }

  const prev = recent[0];
  if (prev !== null) {
    const step = S(target) / S(shiftMonth(target, -1));
    estimates.push({
      key: "mom",
      value: prev * step * targetWeight,
      basis: `${label(shiftMonth(target, -1))}: ${mln(turnover.get(shiftMonth(target, -1))!)} · сезонный переход ${ratio(step)}`,
    });
  }

  const levels = [1, 2, 3].flatMap((k) => {
    const m = shiftMonth(target, -k);
    const v = z(m);
    return v === null ? [] : [v / S(m)];
  });
  if (levels.length >= 2) {
    const level = levels.reduce((s, v) => s + v, 0) / levels.length;
    estimates.push({
      key: "level",
      value: level * S(target) * targetWeight,
      basis: `Средний уровень ${levels.length} последних полных месяцев без сезона · сезон ${label(target).split(" ")[0]} ${ratio(S(target))}`,
    });
  }
  return combine(estimates, FORECAST_WEIGHTS.turnover, (n) => Math.round(n / 10000) * 10000);
}

/** Прогноз доли алкоголя (%) на месяц `target`. */
export function forecastShare(input: { target: MonthKey; share: Map<MonthKey, number>; complete: Set<MonthKey> }): Forecast {
  const { target, share, complete } = input;
  const a = (m: MonthKey): number | null => {
    const v = share.get(m);
    return v == null || !complete.has(m) ? null : v;
  };
  const estimates: Omit<ForecastEstimate, "weight">[] = [];
  const lastYear = a(shiftMonth(target, -12));
  const recent = [1, 2, 3].map((k) => a(shiftMonth(target, -k)));
  const recentLastYear = [1, 2, 3].map((k) => a(shiftMonth(target, -12 - k)));
  if (lastYear !== null && recent.every((v) => v !== null) && recentLastYear.every((v) => v !== null)) {
    const shift = recent.reduce((s, v) => s + v!, 0) / 3 - recentLastYear.reduce((s, v) => s + v!, 0) / 3;
    estimates.push({
      key: "yoy",
      value: lastYear + shift,
      basis: `${label(shiftMonth(target, -12))}: ${lastYear.toLocaleString("ru-RU")}% · за три месяца доля ${shift >= 0 ? "выше" : "ниже"} прошлого года на ${Math.abs(Math.round(shift * 10) / 10).toLocaleString("ru-RU")} п. п.`,
    });
  }
  const prev = recent[0];
  if (prev !== null) {
    const ly = a(shiftMonth(target, -12));
    const lyPrev = a(shiftMonth(target, -13));
    const step = ly !== null && lyPrev !== null && lyPrev > 0 ? ly / lyPrev : 1;
    estimates.push({
      key: "mom",
      value: prev * step,
      basis: `${label(shiftMonth(target, -1))}: ${prev.toLocaleString("ru-RU")}%${step !== 1 ? ` · переход год назад ${ratio(step)}` : " · без сезонной поправки"}`,
    });
  }
  return combine(estimates, FORECAST_WEIGHTS.share, (n) => Math.round(n * 10) / 10);
}
