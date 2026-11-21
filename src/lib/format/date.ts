/**
 * Даты в интерфейсе по правилам `docs/design-system.md` («Деньги, числа,
 * даты»): в ячейке таблицы — `ДД.ММ.ГГГГ`, в заголовках и лентах —
 * «16 ноября», с временем — «16 ноября, 14:05». Год дописывается, только
 * если дата не в текущем году. Пустое или битое значение — `null`, экран сам
 * решает, показать «—» или опустить строку.
 */

function parse(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  // Голая дата `YYYY-MM-DD` — это календарный день, а не полночь UTC:
  // `new Date("2026-11-16")` в Москве дал бы 16-е, а западнее — 15-е.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const cellFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/*
 * Последний аргумент `timeZone` — пояс заведения. Без него — пояс процесса
 * (в браузере — пользователя, на сервере — сервера, и ночные события
 * съезжают на соседний день). С ним момент `2026-11-16T22:30Z` в Москве —
 * уже 17 ноября. Голая дата `YYYY-MM-DD` — календарный день, пояс её не
 * сдвигает.
 */

function zoned(value: string | Date | null | undefined, timeZone: string | undefined) {
  if (!timeZone) {
    const date = parse(value);
    return date ? { date, timeZone: undefined } : null;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return { date: new Date(Date.UTC(y, m - 1, d, 12)), timeZone: "UTC" };
  }
  const date = parse(value);
  return date ? { date, timeZone } : null;
}

function yearIn(date: Date, timeZone: string | undefined): number {
  if (!timeZone) return date.getFullYear();
  return Number(new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone }).format(date));
}

/** `16.11.2026` — дата в ячейке таблицы. */
export function formatDateCell(
  value: string | Date | null | undefined,
  timeZone?: string,
): string | null {
  const z = zoned(value, timeZone);
  if (!z) return null;
  if (!z.timeZone) return cellFormat.format(z.date);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: z.timeZone,
  }).format(z.date);
}

function dayMonthParts(date: Date, now: Date, timeZone?: string, nowZone?: string) {
  return {
    day: "numeric" as const,
    month: "long" as const,
    ...(yearIn(date, timeZone) === yearIn(now, nowZone) ? {} : { year: "numeric" as const }),
    ...(timeZone ? { timeZone } : {}),
  };
}

/** «16 ноября» (или «16 ноября 2025 г.» для другого года). */
export function formatDayMonth(
  value: string | Date | null | undefined,
  now: Date = new Date(),
  timeZone?: string,
): string | null {
  const z = zoned(value, timeZone);
  if (!z) return null;
  return new Intl.DateTimeFormat("ru-RU", dayMonthParts(z.date, now, z.timeZone, timeZone)).format(z.date);
}

/** «16 ноября, 14:05». */
export function formatDayMonthTime(
  value: string | Date | null | undefined,
  now: Date = new Date(),
  timeZone?: string,
): string | null {
  const date = parse(value);
  if (!date) return null;
  const day = new Intl.DateTimeFormat("ru-RU", dayMonthParts(date, now, timeZone, timeZone)).format(date);
  const time = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
  return `${day}, ${time}`;
}
