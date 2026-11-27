/**
 * Дата акта инвентаризации: перевод между календарным днём заведения
 * (`YYYY-MM-DD`, его выбирает пользователь) и моментом `invoiceDate`, который
 * хранит Quick Resto.
 *
 * Расчётный остаток в Quick Resto считается на момент `invoiceDate`, поэтому при
 * смене дня время суток акта сохраняем как было: меняется только день. Если
 * исходной даты нет, ставим полдень по времени заведения — так же акт пересчёта
 * создаётся на 12:00 по Москве (см. recount.ts).
 *
 * Без импортов из `@/...`: node:test импортирует файл напрямую.
 */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Части местного времени момента `at` в поясе `timeZone`. */
function wallClock(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
    millisecond: at.getUTCMilliseconds(),
  };
}

/** Смещение пояса от UTC в миллисекундах в момент `at`. */
function offsetMs(at: Date, timeZone: string): number {
  const w = wallClock(at, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second, w.millisecond);
  return asUtc - at.getTime();
}

/** Момент, когда в поясе `timeZone` на часах указанное местное время. */
function zonedWallToInstant(
  wall: { year: number; month: number; day: number; hour: number; minute: number; second: number; millisecond: number },
  timeZone: string,
): number {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second, wall.millisecond);
  // Смещение берём дважды: второй раз — в найденный момент, чтобы день
  // перехода на летнее время не съехал на час.
  let instant = naive - offsetMs(new Date(naive), timeZone);
  instant = naive - offsetMs(new Date(instant), timeZone);
  return instant;
}

/** Валиден ли `YYYY-MM-DD` как настоящий календарный день (не 2026-02-30). */
export function isCalendarDay(value: string): boolean {
  const match = DAY_RE.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Календарный день момента `value` в поясе заведения: `YYYY-MM-DD`. */
export function invoiceDayInZone(value: string | null | undefined, timeZone: string): string | null {
  if (!value) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  const w = wallClock(at, timeZone);
  return `${String(w.year).padStart(4, "0")}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/**
 * Новый `invoiceDate` (мс) для дня `day`: время суток берётся из исходной
 * даты акта в поясе заведения, без исходной даты — 12:00.
 * Невалидный день → null.
 */
export function moveInvoiceDateToDay(input: {
  original: string | null | undefined;
  day: string;
  timeZone: string;
}): number | null {
  if (!isCalendarDay(input.day)) return null;
  const [y, m, d] = input.day.split("-").map(Number);
  const original = input.original ? new Date(input.original) : null;
  const time =
    original && !Number.isNaN(original.getTime())
      ? wallClock(original, input.timeZone)
      : { hour: 12, minute: 0, second: 0, millisecond: 0 };
  return zonedWallToInstant(
    {
      year: y,
      month: m,
      day: d,
      hour: time.hour,
      minute: time.minute,
      second: time.second,
      millisecond: time.millisecond,
    },
    input.timeZone,
  );
}

/** Поля акта, от которых зависит, можно ли менять его дату. */
export type InventoryDateLockInput = {
  status: string;
  processed: boolean | null;
  results_finalized_at: string | null;
  archived_at: string | null;
};

/**
 * Почему дату акта сейчас менять нельзя, либо null.
 *
 * Проведённый акт уже двинул остатки в Quick Resto на свою дату — переносить
 * его нельзя. Зафиксированные итоги построены на расчётных остатках старой
 * даты: смена даты молча разошлась бы с утверждёнными числами, поэтому сначала
 * итоги переоткрывают.
 */
export function getInventoryDateLockReason(doc: InventoryDateLockInput): string | null {
  if (doc.archived_at) return "Этот акт удалён в Quick Resto и недоступен для изменений.";
  if (doc.processed || doc.status === "processed") {
    return "Акт проведён в Quick Resto — дату проведённого акта изменить нельзя.";
  }
  if (doc.results_finalized_at) {
    return "Итоги акта зафиксированы. Переоткройте итоги, чтобы изменить дату.";
  }
  return null;
}
