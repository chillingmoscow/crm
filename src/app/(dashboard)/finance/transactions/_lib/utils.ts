// Helpers for the transactions module: amount/date formatting, color
// generation for new categories, URL detection in descriptions.
//
// Behaviour matches the legacy CRA build (see docs/finance/legacy-transactions-spec.md §10),
// except formatDateTimeShort, which renders the "DD.MM · HH:MM" pattern
// from the new design.

const CATEGORY_COLORS = [
  "#FF6B6B", "#FF9F43", "#FFA94D", "#FFC93C", "#A0E14C",
  "#4ECDC4", "#45B7D1", "#5C6BC0", "#7E57C2", "#AB47BC",
  "#EC407A", "#26A69A", "#66BB6A", "#9CCC65", "#FFCA28",
  "#FFA726",
] as const;

export function generateRandomColor(): string {
  return CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)];
}

/** Forms 1234,56 ₽-style strings using ru-RU locale. signDisplay: 'never' — sign is rendered separately by the UI. */
export function formatCurrency(
  amount: number,
  currency: string = "RUB",
  scale?: AmountRoundingScale
): string {
  return formatMoney(Math.abs(amount), currency, scale);
}

/** "01.05.2026" */
export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("ru-RU");
}

/** "01.05.2026, 14:23" — used in the audit-history block. */
export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Two-line "DD.MM" + "HH:MM" parts. Used in the table date column to
 * match the design's "28.04 · 14:32" layout. Time is taken from
 * created_at, falling back to the date itself if not provided
 * (since `transactions.date` is just a date, not a timestamp).
 */
export function splitDateTime(
  isoDate: string,
  createdAt: string | null
): { date: string; time: string } {
  const dateOnly = new Date(isoDate).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
  const ts = createdAt ? new Date(createdAt) : null;
  const time =
    ts &&
    ts.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }) === dateOnly
      ? ts.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
      : "";
  return { date: dateOnly, time };
}

/** "12,3 К ₽" / "1,5 М ₽" / "240 ₽" — short-form for table account-balance hints. */
export function formatShortAmount(amount: number, currency: string, scale: AmountRoundingScale): string {
  const abs = Math.abs(amount);
  const format = (value: number) =>
    value.toLocaleString("ru-RU", {
      minimumFractionDigits: scale,
      maximumFractionDigits: scale,
    });
  let short: string;
  if (abs >= 1_000_000) short = `${format(abs / 1_000_000)}М`;
  else if (abs >= 1_000) short = `${format(abs / 1_000)}К`;
  else short = format(abs);
  const symbol =
    currency === "RUB" ? "₽" :
    currency === "USD" ? "$" :
    currency === "EUR" ? "€" : currency;
  return `${short} ${symbol}`;
}

export type LinkifyPart = { type: "text"; value: string } | { type: "link"; value: string };

/** Splits text into text/link parts. Caller renders an <a> for links so the helper stays JSX-free. */
export function linkifyParts(text: string): LinkifyPart[] {
  if (!text) return [];
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text
    .split(urlRegex)
    .filter((p) => p !== "")
    .map((part) =>
      urlRegex.test(part)
        ? ({ type: "link" as const, value: part })
        : ({ type: "text" as const, value: part })
    );
}

/** Today's local-date in ISO date format ("YYYY-MM-DD"). Local, not UTC — see TransactionForm.todayIso. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
import { formatMoney, type AmountRoundingScale } from "@/lib/format/amount";
