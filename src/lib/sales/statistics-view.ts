import type { SalesMonth } from "./monthly";
import {
  combineStatisticsMonths,
  type StatisticsReport,
} from "./statistics-reports";
import { addDays, localTimestamp, validDate } from "./time";
import { effectiveMetrics, metricKeys, type SalesDay } from "./types";

export type StatisticsArchive = {
  id: string;
  venue_id: string;
  month: string;
  metrics: Record<string, number | null>;
  weekday_turnover: (number | null)[];
  note: string;
  captured_at: string;
  origin: { spreadsheet_id: string; range: string };
};
export type StatisticsValue = {
  value: number | null;
  hint?: string;
  known?: number;
  total?: number;
  through?: string;
  updatedAt?: string;
  state?: StatisticsReport["state"];
};
export type StatisticsRow = {
  month: string;
  values: Record<string, StatisticsValue>;
  native?: SalesMonth;
  archive?: StatisticsArchive;
};
export const reportFields = {
  alcoholRevenue: { kind: "alcohol", field: "revenue" },
  alcoholShare: { kind: "alcohol", field: "revenue" },
  regularGuests: { kind: "regular_guests", field: "guests" },
  regularRevenue: { kind: "regular_guests", field: "revenue" },
  regularShare: { kind: "regular_guests", field: "revenue" },
  averageCheck: { kind: "average_check", field: "average" },
} as const;

/** The denominator must cover exactly the report's saved working-day window.
 * Never mix an old 12:00 report, partial daily sums, or an open day with 09:00 sales. */
export function statisticsRevenueShare(
  report: StatisticsReport | undefined,
  days: SalesDay[],
  timezone: string,
  hour: number,
): StatisticsValue {
  const missing = (hint: string): StatisticsValue => ({ value: null, hint });
  if (!report?.metrics || !Number.isFinite(report.metrics.revenue))
    return missing("Нет выручки отчёта");
  const through = report.through_date;
  const start = report.month;
  if (
    !through ||
    !validDate(start) ||
    !validDate(through) ||
    !start.endsWith("-01") ||
    through.slice(0, 7) !== start.slice(0, 7)
  )
    return missing("Период отчёта не подтверждён");
  if (
    Date.parse(report.period_start ?? "") !==
      localTimestamp(start, hour, timezone) ||
    Date.parse(report.period_end ?? "") !==
      localTimestamp(addDays(through, 1), hour, timezone) - 1
  )
    return missing("Отчёт и продажи рассчитаны за разные рабочие периоды");
  const selected = days.filter(
    (d) => d.business_date >= start && d.business_date <= through,
  );
  if (
    selected.some((d) => d.venue_id !== report.venue_id) ||
    new Set(selected.map((d) => d.business_date)).size !== selected.length
  )
    return missing("Состав исходных смен не совпадает с отчётом");
  const expected = Number(through.slice(-2));
  if (
    selected.length !== expected ||
    selected.some(
      (d) =>
        d.status === "preliminary" ||
        effectiveMetrics(d).turnover === null ||
        !Number.isFinite(effectiveMetrics(d).turnover),
    )
  )
    return missing("Не все завершённые смены периода загружены");
  if (
    selected.some((d) => {
      const saved = d.source_summary?.settings as
        | { timezone?: string; day_start_hour?: number }
        | undefined;
      return saved?.timezone !== timezone || saved?.day_start_hour !== hour;
    })
  )
    return missing("Рабочий период исходных смен не подтверждён");
  const turnover = selected.reduce(
    (sum, d) => sum + effectiveMetrics(d).turnover!,
    0,
  );
  if (turnover <= 0) return missing("В периоде нет положительного оборота");
  return {
    value: Math.round((report.metrics.revenue! / turnover) * 10000) / 100,
    through,
    hint: `Доля от оборота за 1–${expected} число`,
  };
}

export function buildStatisticsRows(
  days: SalesDay[],
  reports: StatisticsReport[],
  archives: StatisticsArchive[],
  source: "native" | "archive",
  timezone: string,
  hour: number,
): StatisticsRow[] {
  if (
    new Set([
      ...days.map((d) => d.venue_id),
      ...reports.map((r) => r.venue_id),
      ...archives.map((a) => a.venue_id),
    ]).size > 1
  )
    throw new Error("Статистика должна относиться к одному заведению");
  if (source === "archive") {
    const latest = new Map<string, StatisticsArchive>();
    for (const a of archives) {
      if (
        !validDate(a.month) ||
        !a.month.endsWith("-01") ||
        !Number.isFinite(Date.parse(a.captured_at))
      )
        throw new Error("Некорректный снимок статистики");
      const old = latest.get(a.month);
      if (!old || Date.parse(a.captured_at) > Date.parse(old.captured_at))
        latest.set(a.month, a);
    }
    return [...latest.values()]
      .sort((a, b) => b.month.localeCompare(a.month))
      .map((a) => ({
        month: a.month.slice(0, 7),
        archive: a,
        values: Object.fromEntries(
          Object.entries(a.metrics).map(([key, value]) => [key, { value }]),
        ),
      }));
  }
  const reportMap = new Map(
    reports.map((r) => [`${r.month.slice(0, 7)}:${r.kind}`, r]),
  );
  return combineStatisticsMonths(days, reports).map((m) => {
    const values: StatisticsRow["values"] = {
      shifts: { value: m.shifts || null },
      hookahShare: { value: m.hookahShare },
      barShare: { value: m.barShare },
      perShift: { value: m.perShift },
    };
    for (const key of metricKeys) values[key] = { ...m.totals[key] };
    for (const [key, spec] of Object.entries(reportFields)) {
      const r = reportMap.get(`${m.month}:${spec.kind}`);
      const value = key.endsWith("Share")
        ? statisticsRevenueShare(r, days, timezone, hour)
        : { value: r?.metrics?.[spec.field] ?? null };
      values[key] = {
        ...value,
        through: r?.through_date ?? undefined,
        updatedAt: r?.synced_at ?? undefined,
        state: r?.state,
        hint: r?.last_error ?? value.hint,
      };
    }
    return { month: m.month, native: m, values };
  });
}

/** A missing month breaks the line instead of connecting unrelated periods. */
export function statisticsSeries(rows: StatisticsRow[], key: string) {
  if (!rows.length) return [];
  const byMonth = new Map(
    rows.map((r) => [r.month, r.values[key]?.value ?? null]),
  );
  const months = [...byMonth.keys()].sort();
  const result: { month: string; value: number | null }[] = [];
  for (let month = months[0]; month <= months.at(-1)!; ) {
    result.push({ month, value: byMonth.get(month) ?? null });
    const [year, m] = month.split("-").map(Number);
    month = new Date(Date.UTC(year, m, 1)).toISOString().slice(0, 7);
  }
  return result;
}
