/**
 * Календарные дни в часовом поясе аккаунта (`accounts.timezone`).
 *
 * Дата операции — момент времени: у ручных операций это полночь UTC
 * выбранного дня, выплаты зарплаты пишутся с часами. Какой это день и где
 * проходит граница дня, решает пояс аккаунта — так же считает база
 * (`get_active_account_timezone`, миграция 370), и цифры периодов совпадают
 * в списке, на дашборде и в справочниках.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function parts(date: Date, timeZone: string) {
  const values: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return values;
}

/** Смещение пояса от UTC в миллисекундах в данный момент. */
function offsetMs(date: Date, timeZone: string): number {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * `YYYY-MM-DD` — какой это день в поясе. Голую дату возвращает как есть:
 * это уже календарный день.
 */
export function calendarDateInZone(value: string, timeZone: string): string {
  if (ISO_DAY.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const p = parts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Момент начала дня `YYYY-MM-DD` в поясе, ISO в UTC. */
export function dayStartInZone(day: string, timeZone: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  let start = guess.getTime() - offsetMs(guess, timeZone);
  // Переход на летнее время между полуночью UTC и полуночью пояса меняет
  // смещение: перепроверяем по найденному моменту.
  start = guess.getTime() - offsetMs(new Date(start), timeZone);
  return new Date(start).toISOString();
}

/** Момент начала следующего дня — правая граница «по `day` включительно». */
export function dayEndExclusiveInZone(day: string, timeZone: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const iso = next.toISOString().slice(0, 10);
  return dayStartInZone(iso, timeZone);
}
