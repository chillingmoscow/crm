import type { ChecklistItem, Answer } from "./types";
export function dateInZone(value: string | Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}-${parts.find((p) => p.type === "day")?.value}`;
}
export function timeInZone(value: string, timezone: string) {
  return new Intl.DateTimeFormat("ru", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
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
  return new Intl.DateTimeFormat("ru", { ...options, timeZone: "UTC" }).format(
    new Date(date + "T12:00:00Z"),
  );
}
export function shiftHours(start: string, end: string, pause: number) {
  return Math.max(
    0,
    (new Date(end).getTime() - new Date(start).getTime()) / 3600000 -
      pause / 60,
  );
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
