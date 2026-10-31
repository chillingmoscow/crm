import {
  defaultAdditionalRules,
  type AdditionalArchive,
  type AdditionalDay,
  type AdditionalKind,
  type AdditionalMetrics,
  type AdditionalRules,
} from "./additional";
export type AdditionalRow = {
  id: string;
  date: string;
  kind: AdditionalKind;
  metrics: AdditionalMetrics | null;
  rules: AdditionalRules;
  native?: AdditionalDay;
  archive?: AdditionalArchive;
};
export function additionalRows(
  reports: AdditionalDay[],
  archives: AdditionalArchive[],
  source: "native" | "archive",
  kind: AdditionalKind,
): AdditionalRow[] {
  if (source === "native")
    return reports
      .filter((r) => r.kind === kind)
      .map((r) => ({
        id: r.id,
        date: r.business_date,
        kind,
        metrics: r.metrics,
        rules: (r.metrics_request ?? r.request).rules,
        native: r,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  const latest = new Map<string, AdditionalArchive>();
  for (const r of archives.filter((r) => r.kind === kind)) {
    const old = latest.get(r.business_date);
    if (
      !old ||
      r.captured_at > old.captured_at ||
      (r.captured_at === old.captured_at && r.id > old.id)
    )
      latest.set(r.business_date, r);
  }
  return [...latest.values()]
    .map((r) => ({
      id: r.id,
      date: r.business_date,
      kind,
      metrics: r.metrics,
      rules: defaultAdditionalRules,
      archive: r,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
export function additionalValue(r: AdditionalRow, key: string): number | null {
  if (!r.metrics) return null;
  if (key in r.metrics && key !== "quantities")
    return r.metrics[key as Exclude<keyof AdditionalMetrics, "quantities">];
  return r.metrics.quantities[key] ?? null;
}
export function additionalTotal(rows: AdditionalRow[], key: string) {
  const known = rows.flatMap((r) =>
    additionalValue(r, key) === null ? [] : [additionalValue(r, key)!],
  );
  return {
    value: known.length
      ? Math.round(known.reduce((a, b) => a + b, 0) * 100) / 100
      : null,
    known: known.length,
    total: rows.length,
  };
}

/** Full closed-day coverage, including dates for which no report was requested. */
export function additionalCoverage(
  month: string,
  lastClosed: string,
  firstValid?: string,
) {
  const first = [month.slice(0, 7) + "-01", firstValid ?? "2000-01-01"]
    .sort()
    .at(-1)!;
  if (lastClosed < first) return 0;
  const [year, m] = month.slice(0, 7).split("-").map(Number);
  const end = new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
  const through = lastClosed < end ? lastClosed : end;
  return through < first
    ? 0
    : Math.round((Date.parse(through) - Date.parse(first)) / 86400000) + 1;
}
