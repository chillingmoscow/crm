// Сезонность заведения для прогноза плана (дизайн 2026-11-27-sales-plan-forecast-kpi-v2).
// Индексы — на день: средний оборот дня месяца к среднему дню года, январь…декабрь,
// среднее 1. Чистые функции — их гоняет node --test.

import type { SeasonIndex } from "./forecast.ts";

/**
 * Отраслевая сезонность по умолчанию — оборот общественного питания г. Москвы
 * (Росстат, «Социально-экономическое положение России», раздел «Рестораны, кафе
 * и бары», строка Москвы), в сопоставимых ценах (ИПЦ услуг общепита по России),
 * на день, среднее 2024–2025. Собрано 27.11.2026; 2025 — по месячным выпускам,
 * 2024 — пересчётом 2025 через индексы к прошлому году. 2022–2023 недоступны.
 */
export const INDUSTRY_SEASONALITY: { index: SeasonIndex; source: string; years: string; note: string } = {
  index: normalize([0.852, 1.029, 0.959, 0.999, 0.97, 0.991, 0.939, 0.988, 1.032, 1.053, 1.03, 1.157]),
  source: "Росстат, общепит Москвы, 2024–2025",
  years: "2024–2025",
  note: "Официальный ряд короткий (один полный год наблюдений) и заметно пересматривается, поэтому индекс грубый: поправьте его под заведение.",
};

/** Описание сезонов словами владельца (27.11.2026) — подсказка в «Сезонности». */
export const OWNER_SEASON_NOTE =
  "Сентябрь — раскачка, октябрь — хорошо, ноябрь и декабрь — пик, январь — послепраздничное затишье, февраль, март и первая половина апреля — хорошо, дальше майские, тёплая погода и летний спад.";

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
export function ownSeasonIndex(daily: { date: string; turnover: number }[], currentMonth?: string): (number | null)[] {
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
    if (m.days !== daysIn(ym) || (currentMonth && ym >= currentMonth.slice(0, 7))) continue;
    perDay[Number(ym.slice(5, 7)) - 1] = m.sum / m.days;
  }
  if (perDay.some((v) => v === null || v <= 0)) return Array(12).fill(null);
  return normalize(perDay as number[]);
}
