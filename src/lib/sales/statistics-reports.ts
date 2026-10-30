import { businessDate, localTimestamp, validDate } from "./time";
import { aggregateSalesMonths, type SalesMonth } from "./monthly";
import { metricKeys, type SalesDay } from "./types";

export const statisticsReportKinds = [
  "alcohol",
  "regular_guests",
  "average_check",
] as const;
export type StatisticsReportKind = (typeof statisticsReportKinds)[number];
export type StatisticsReportValues = {
  revenue?: number;
  guests?: number;
  average?: number;
};
export type StatisticsReport = {
  id: string;
  venue_id: string;
  month: string;
  kind: StatisticsReportKind;
  metrics: StatisticsReportValues | null;
  period_start: string | null;
  period_end: string | null;
  synced_at: string | null;
  through_date: string | null;
  state: "pending" | "running" | "ready" | "error";
  last_error: string | null;
};
export function combineStatisticsMonths(
  days: SalesDay[],
  reports: StatisticsReport[],
): SalesMonth[] {
  const venues = new Set([
    ...days.map((d) => d.venue_id),
    ...reports.map((r) => r.venue_id),
  ]);
  if (venues.size > 1)
    throw new Error("Статистика должна относиться к одному заведению");
  const months = aggregateSalesMonths(days);
  for (const r of reports) {
    if (!validDate(r.month) || !r.month.endsWith("-01"))
      throw new Error("Некорректный месяц отчёта");
    const month = r.month.slice(0, 7);
    if (months.some((m) => m.month === month)) continue;
    months.push({
      month,
      shifts: 0,
      preliminary: 0,
      errors: 0,
      corrected: 0,
      hookahShare: null,
      barShare: null,
      perShift: null,
      totals: Object.fromEntries(
        metricKeys.map((k) => [k, { value: null, known: 0, total: 0 }]),
      ) as SalesMonth["totals"],
    });
  }
  return months.sort((a, b) => b.month.localeCompare(a.month));
}

/** Same working-day boundary as native sales. The open working day is excluded. */
export function statisticsReportWindow(
  month: string,
  timezone: string,
  hour: number,
  now = new Date(),
) {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    Number(month.slice(0, 4)) < 2000 ||
    Number(month.slice(0, 4)) > 2100 ||
    !validDate(month + "-01") ||
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23
  )
    throw new Error("Проверьте месяц и начало рабочего дня");
  const start = month + "-01";
  const [year, m] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, m, 1, 12)).toISOString().slice(0, 10);
  const cutoff = businessDate(now, timezone, hour);
  const end = next < cutoff ? next : cutoff;
  if (end <= start) return null;
  return {
    start: localTimestamp(start, hour, timezone),
    end: localTimestamp(end, hour, timezone) - 1,
    startDate: start,
    endDate: end,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function numeric(value: unknown, label: string, integer = false) {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    value === "" ||
    (typeof value === "string" && !/^-?\d+(\.\d+)?$/.test(value))
  )
    throw new Error(`Quick Resto не вернул показатель «${label}»`);
  const n = Number(value);
  if (
    !Number.isFinite(n) ||
    Math.abs(n) > 1e12 ||
    (integer && (!Number.isSafeInteger(n) || n < 0))
  )
    throw new Error(`Quick Resto вернул некорректный показатель «${label}»`);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
/** Parse the actual published n8n report contract, without inferring a missing value as zero. */
export function parseStatisticsReport(
  kind: StatisticsReportKind,
  raw: unknown,
): StatisticsReportValues {
  const report = record(raw),
    utility = record(report.utilityData),
    aggregates = record(utility.aggregates);
  if (kind === "alcohol")
    return { revenue: numeric(aggregates.salesSum, "Продажи алкоголя") };
  if (kind === "regular_guests")
    return {
      revenue: numeric(aggregates.totalSum, "Выручка постоянных гостей"),
      guests: numeric(aggregates.customer, "Постоянные гости", true),
    };
  if (kind !== "average_check") throw new Error("Неизвестный отчёт");
  // The real report has an aggregate average plus hundreds of detail receipts.
  // Detail salesSum values are receipt amounts, not independent averages.
  if ("salesSum" in aggregates)
    return { average: numeric(aggregates.salesSum, "Средний чек") };
  const rows = Array.isArray(report.ds) ? report.ds : [];
  const root = record(record(rows[0]).object);
  if (rows.length !== 1 || root.grouped !== true || root._Level !== 0)
    throw new Error("Quick Resto не вернул единый показатель среднего чека");
  return {
    average: numeric(root.salesSum, "Средний чек"),
  };
}
