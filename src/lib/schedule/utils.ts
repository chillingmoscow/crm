import type { ChecklistItem, Answer } from "./types";
import { dateTimeFormat } from "../intl-cache.ts";

// Дата смены в поясе заведения нужна сетке расписания тысячи раз за рендер
// (по каждой смене, дню и сотруднику), а аргументы повторяются: одни и те же
// starts_at. Ответ запоминается; потолок — чтобы долгая сессия не копила
// память.
const dateInZoneCache = new Map<string, string>();
export function dateInZone(value: string | Date, timezone: string) {
  const key = typeof value === "string" ? `${timezone}|${value}` : null;
  const cached = key === null ? undefined : dateInZoneCache.get(key);
  if (cached !== undefined) return cached;
  const parts = dateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const date = `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}-${parts.find((p) => p.type === "day")?.value}`;
  if (key !== null) {
    if (dateInZoneCache.size >= 20000) dateInZoneCache.clear();
    dateInZoneCache.set(key, date);
  }
  return date;
}
export function timeInZone(value: string, timezone: string) {
  return dateTimeFormat("ru", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}
/**
 * Момент времени (ISO, UTC) для даты и времени по часам заведения:
 * «2026-11-18», «14:00», «Europe/Moscow» → «2026-11-18T11:00:00.000Z».
 * null — если дата или время не заданы.
 */
export function instantInZone(date: string, time: string, timezone: string): string | null {
  const naive = Date.parse(`${date}T${time.slice(0, 5)}:00Z`);
  // Пустая или неполная дата/время — момента нет; не роняем рендер.
  if (Number.isNaN(naive)) return null;
  const offset = (at: number) => {
    const p = dateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(at));
    const v = (t: string) => Number(p.find((x) => x.type === t)?.value);
    return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second")) - at;
  };
  // Две итерации — на случай перехода на летнее/зимнее время между догадками.
  const first = naive - offset(naive);
  return new Date(naive - offset(first)).toISOString();
}
export function addDays(date: string, days: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function weekStart(date: string) {
  const d = new Date(date + "T12:00:00Z");
  return addDays(date, -((d.getUTCDay() + 6) % 7));
}
export function dayLabel(
  date: string,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" },
) {
  return dateTimeFormat("ru", { ...options, timeZone: "UTC" }).format(
    new Date(date + "T12:00:00Z"),
  );
}
export function shiftHours(start: string, end: string) {
  return Math.max(0, (Date.parse(end) - Date.parse(start)) / 3600000);
}
export function complete(item: ChecklistItem, value: Answer | undefined) {
  if (item.kind === "info") return true;
  if (item.kind === "check") return value === true;
  if (value == null || value === "") return false;
  if (item.kind === "number")
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (item.min == null || value >= item.min) &&
      (item.max == null || value <= item.max)
    );
  return typeof value === "string" && value.trim().length > 0;
}
