/**
 * Период активности справочников «Финансов» («Статьи», «Контрагенты»).
 * В адресе — `?period=`: `2026-11` (месяц), `2026-Q4` (квартал), `2026`
 * (год); без параметра — всё время. Модуль чистый: его читают и сервер
 * (диапазон дат для подсчёта), и браузер (капсула периода).
 */

export type PeriodKind = "all" | "month" | "quarter" | "year";

export type DirectoryPeriod =
  | { kind: "all" }
  | { kind: "month"; year: number; month: number }
  | { kind: "quarter"; year: number; quarter: number }
  | { kind: "year"; year: number };

/** Раньше этого года операций в учёте нет: дальше стрелка не листает. */
export const PERIOD_MIN_YEAR = 2015;

export const ALL_TIME: DirectoryPeriod = { kind: "all" };

const MONTHS_NOMINATIVE = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];
const QUARTERS = ["I", "II", "III", "IV"];

const pad = (n: number) => String(n).padStart(2, "0");

/** Неверный или пустой параметр — всё время: битая ссылка не ломает страницу. */
export function parsePeriod(param: string | null | undefined): DirectoryPeriod {
  if (!param) return ALL_TIME;
  let match = /^(\d{4})-(\d{2})$/.exec(param);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (validYear(year) && month >= 1 && month <= 12) return { kind: "month", year, month };
    return ALL_TIME;
  }
  match = /^(\d{4})-Q([1-4])$/.exec(param);
  if (match) {
    const year = Number(match[1]);
    return validYear(year) ? { kind: "quarter", year, quarter: Number(match[2]) } : ALL_TIME;
  }
  match = /^(\d{4})$/.exec(param);
  if (match) {
    const year = Number(match[1]);
    return validYear(year) ? { kind: "year", year } : ALL_TIME;
  }
  return ALL_TIME;
}

function validYear(year: number) {
  return year >= PERIOD_MIN_YEAR && year <= 2100;
}

/** Значение для `?period=`; у «всего времени» параметра нет. */
export function periodParam(period: DirectoryPeriod): string | null {
  switch (period.kind) {
    case "all":
      return null;
    case "month":
      return `${period.year}-${pad(period.month)}`;
    case "quarter":
      return `${period.year}-Q${period.quarter}`;
    case "year":
      return String(period.year);
  }
}

/** Границы периода включительно, `ГГГГ-ММ-ДД`; у «всего времени» — null. */
export function periodRange(period: DirectoryPeriod): { from: string | null; to: string | null } {
  switch (period.kind) {
    case "all":
      return { from: null, to: null };
    case "month":
      return { from: `${period.year}-${pad(period.month)}-01`, to: lastDay(period.year, period.month) };
    case "quarter": {
      const first = (period.quarter - 1) * 3 + 1;
      return { from: `${period.year}-${pad(first)}-01`, to: lastDay(period.year, first + 2) };
    }
    case "year":
      return { from: `${period.year}-01-01`, to: `${period.year}-12-31` };
  }
}

function lastDay(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Соседний период того же вида; «всё время» не листается. */
export function shiftPeriod(period: DirectoryPeriod, delta: number): DirectoryPeriod {
  switch (period.kind) {
    case "all":
      return period;
    case "month": {
      const index = period.year * 12 + (period.month - 1) + delta;
      return { kind: "month", year: Math.floor(index / 12), month: (index % 12) + 1 };
    }
    case "quarter": {
      const index = period.year * 4 + (period.quarter - 1) + delta;
      return { kind: "quarter", year: Math.floor(index / 4), quarter: (index % 4) + 1 };
    }
    case "year":
      return { kind: "year", year: period.year + delta };
  }
}

/** Текущий месяц, квартал или год на дату `today` (`ГГГГ-ММ-ДД`). */
export function currentPeriod(kind: PeriodKind, today: string): DirectoryPeriod {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  switch (kind) {
    case "all":
      return ALL_TIME;
    case "month":
      return { kind: "month", year, month };
    case "quarter":
      return { kind: "quarter", year, quarter: Math.ceil(month / 3) };
    case "year":
      return { kind: "year", year };
  }
}

/** Период начинается после `today` — в будущее не листаем. */
export function isFuturePeriod(period: DirectoryPeriod, today: string): boolean {
  const { from } = periodRange(period);
  return from !== null && from > today;
}

/** Период раньше первого года учёта. */
export function isBeforeMinPeriod(period: DirectoryPeriod): boolean {
  return period.kind !== "all" && period.year < PERIOD_MIN_YEAR;
}

/** «ноябрь 2026», «IV квартал 2026», «2026 год», «Всё время». */
export function periodLabel(period: DirectoryPeriod): string {
  switch (period.kind) {
    case "all":
      return "Всё время";
    case "month":
      return `${MONTHS_NOMINATIVE[period.month - 1]} ${period.year}`;
    case "quarter":
      return `${QUARTERS[period.quarter - 1]} квартал ${period.year}`;
    case "year":
      return `${period.year} год`;
  }
}

/** Фраза для подписей: «за ноябрь 2026», «за всё время». */
export function periodPhrase(period: DirectoryPeriod): string {
  return period.kind === "all" ? "за всё время" : `за ${periodLabel(period)}`;
}

/**
 * Ссылка на «Транзакции» с фильтром по записи справочника и датам периода:
 * `/finance/transactions?category_id=…&date_from=…&date_to=…`.
 */
export function transactionsHref(
  filter: { category_id: string } | { counterparty_id: string },
  period: DirectoryPeriod,
): string {
  const params = new URLSearchParams(filter);
  const { from, to } = periodRange(period);
  if (from && to) {
    params.set("date_from", from);
    params.set("date_to", to);
  }
  return `/finance/transactions?${params.toString()}`;
}
