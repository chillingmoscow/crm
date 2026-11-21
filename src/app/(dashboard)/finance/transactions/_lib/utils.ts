// Helpers for the transactions module: URL detection in descriptions,
// local today's date. Money and dates are
// formatted by the shared `@/lib/format/*` helpers.

export type LinkifyPart = { type: "text"; value: string } | { type: "link"; value: string };

/** Splits text into text/link parts. Caller renders an <a> for links so the helper stays JSX-free. */
export function linkifyParts(text: string): LinkifyPart[] {
  if (!text) return [];
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text
    .split(urlRegex)
    .filter((p) => p !== "")
    .map((part) =>
      /^https?:\/\//.test(part)
        ? ({ type: "link" as const, value: part })
        : ({ type: "text" as const, value: part })
    );
}

/** Today's local-date in ISO date format ("YYYY-MM-DD"). Local, not UTC. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
