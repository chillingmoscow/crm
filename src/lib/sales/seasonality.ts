// Сезонность заведения для прогноза плана (дизайн 2026-11-27-sales-plan-forecast-kpi-v2).
// Индексы — на день: средний оборот дня месяца к среднему дню года, январь…декабрь,
// среднее 1. Чистые функции — их гоняет node --test.

import type { SeasonIndex } from "./forecast.ts";

/**
 * Отраслевая сезонность по умолчанию. ВРЕМЕННО — оценка владельца (слова Павла,
 * 27.11.2026), пока не собран ряд Росстата «оборот общественного питания, Москва».
 */
export const INDUSTRY_SEASONALITY: { index: SeasonIndex; source: string; years: string; note: string } = {
  index: normalize([0.85, 1.0, 1.02, 0.98, 0.92, 0.88, 0.87, 0.9, 0.95, 1.05, 1.12, 1.18]),
  source: "оценка владельца",
  years: "—",
  note: "Сентябрь — раскачка, октябрь — хорошо, ноябрь и декабрь — пик, январь — послепраздничное затишье, февраль, март и первая половина апреля — хорошо, дальше майские, тёплая погода и летний спад.",
};

/** Описание сезонов словами Павла — подсказка в «Сезонности». */
export const OWNER_SEASON_NOTE = INDUSTRY_SEASONALITY.note;

function normalize(values: number[]): number[] {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return values.map((v) => Math.round((v / mean) * 1000) / 1000);
}

/** Проверка таблицы сезонности: 12 положительных чисел, нормируются к среднему 1. */
export function parseSeasonIndex(raw: unknown): SeasonIndex {
  if (!Array.isArray(raw) || raw.length !== 12) throw new Error("Сезонность — 12 чисел, по одному на месяц");
  if (raw.some((v) => typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 10))
    throw new Error("Сезонность — положительные числа до 10");
  return normalize(raw as number[]);
}

const daysIn = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

/**
 * Индекс по своим дням: для каждого месяца года — последний полный такой месяц.
 * Пока нет полного года (любого месяца не хватает) — все `null`.
 */
export function ownSeasonIndex(daily: { date: string; turnover: number }[]): (number | null)[] {
  const byMonth = new Map<string, { sum: number; days: number }>();
  for (const d of daily) {
    if (!Number.isFinite(d.turnover)) continue;
    const ym = d.date.slice(0, 7);
    const m = byMonth.get(ym) ?? { sum: 0, days: 0 };
    m.sum += d.turnover;
    m.days += 1;
    byMonth.set(ym, m);
  }
  const perDay: (number | null)[] = Array(12).fill(null);
  for (const ym of [...byMonth.keys()].sort()) {
    const m = byMonth.get(ym)!;
    if (m.days !== daysIn(ym)) continue;
    perDay[Number(ym.slice(5, 7)) - 1] = m.sum / m.days;
  }
  if (perDay.some((v) => v === null || v <= 0)) return Array(12).fill(null);
  return normalize(perDay as number[]);
}
