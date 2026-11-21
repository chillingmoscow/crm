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

/** `16.11.2026` — дата в ячейке таблицы. */
export function formatDateCell(value: string | Date | null | undefined): string | null {
  const date = parse(value);
  return date ? cellFormat.format(date) : null;
}

function dayMonthParts(date: Date, now: Date) {
  return {
    day: "numeric" as const,
    month: "long" as const,
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" as const }),
  };
}

/** «16 ноября» (или «16 ноября 2025 г.» для другого года). */
export function formatDayMonth(
  value: string | Date | null | undefined,
  now: Date = new Date(),
  /** Часовой пояс заведения для момента времени (timestamptz): на сервере
   *  без него день считается в поясе процесса и ночные события съезжают. */
  timeZone?: string,
): string | null {
  const date = parse(value);
  if (!date) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    ...dayMonthParts(date, now),
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

/** «16 ноября, 14:05». */
export function formatDayMonthTime(
  value: string | Date | null | undefined,
  now: Date = new Date(),
  /** Часовой пояс заведения — см. `formatDayMonth`. */
  timeZone?: string,
): string | null {
  const date = parse(value);
  if (!date) return null;
  const zone = timeZone ? { timeZone } : {};
  const day = new Intl.DateTimeFormat("ru-RU", { ...dayMonthParts(date, now), ...zone }).format(date);
  const time = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    ...zone,
  }).format(date);
  return `${day}, ${time}`;
}
