/** Stable JSON comparison for verified source snapshots and jsonb round trips. */
export function canonicalSourceValue(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalSourceValue).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonicalSourceValue((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
