export type QuickDate = "today" | "tomorrow" | "in7";

function toISO(d: Date): string {
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

/** Display form for a stored date property value. Empty/invalid → "". */
export function formatPropertyDate(value: string | null | undefined): string {
  if (!value) return "";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
