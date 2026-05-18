export type QuickDate = "today" | "tomorrow" | "in7";

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD for a quick-pick relative to `anchor` (default: now). */
export function quickDateISO(kind: QuickDate, anchor: Date = new Date()): string {
  const base = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate(),
  );
  if (kind === "tomorrow") base.setDate(base.getDate() + 1);
  if (kind === "in7") base.setDate(base.getDate() + 7);
  return toISO(base);
}

/** Разбирает хранимое значение даты на дату и опциональное время.
 *  Формат: `YYYY-MM-DD` либо `YYYY-MM-DDTHH:mm`. */
export function splitDateValue(value: string | null | undefined): {
  date: string;
  time: string | null;
} {
  if (!value) return { date: "", time: null };
  const [date, time] = value.split("T");
  return { date: date ?? "", time: time ? time.slice(0, 5) : null };
}

/** Склеивает дату и опциональное время обратно в хранимое значение. */
export function joinDateValue(date: string, time: string | null): string {
  if (!date) return "";
  return time ? `${date}T${time}` : date;
}

/** Display form for a stored date property value. Empty/invalid → "".
 *  При наличии времени добавляет «, HH:mm». */
export function formatPropertyDate(value: string | null | undefined): string {
  const { date, time } = splitDateValue(value);
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return "";
  const base = dt.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return time ? `${base}, ${time}` : base;
}
