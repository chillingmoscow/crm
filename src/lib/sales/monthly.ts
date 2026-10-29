import {
  effectiveMetrics,
  metricKeys,
  type MetricKey,
  type SalesDay,
} from "./types";

export type MetricTotal = {
  value: number | null;
  known: number;
  total: number;
};
export type SalesMonth = {
  month: string;
  shifts: number;
  preliminary: number;
  errors: number;
  corrected: number;
  totals: Record<MetricKey, MetricTotal>;
  hookahShare: number | null;
  barShare: number | null;
  perShift: number | null;
};

const rounded = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Missing values stay missing. A known zero participates in coverage and averages. */
export function sumSalesMetric(days: SalesDay[], key: MetricKey): MetricTotal {
  const values = days
    .map((d) => effectiveMetrics(d)[key])
    .filter((v): v is number => v !== null && Number.isFinite(v));
  return {
    value: values.length ? rounded(values.reduce((s, v) => s + v, 0)) : null,
    known: values.length,
    total: days.length,
  };
}

export function aggregateSalesMonths(days: SalesDay[]): SalesMonth[] {
  const groups = new Map<string, SalesDay[]>();
  const seen = new Set<string>();
  const venues = new Set(days.map((d) => `${d.account_id}:${d.venue_id}`));
  if (venues.size > 1)
    throw new Error("Статистика должна относиться к одному заведению");
  for (const d of days) {
    if (seen.has(d.business_date))
      throw new Error("Повторяющиеся рабочие дни в статистике");
    seen.add(d.business_date);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(d.business_date) ||
      new Date(`${d.business_date}T12:00:00Z`).toISOString().slice(0, 10) !==
        d.business_date
    )
      throw new Error("Некорректная дата смены");
    const month = d.business_date.slice(0, 7);
    const group = groups.get(month) ?? [];
    group.push(d);
    groups.set(month, group);
  }
  return [...groups]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, shifts]) => {
      const totals = Object.fromEntries(
        metricKeys.map((key) => [key, sumSalesMetric(shifts, key)]),
      ) as SalesMonth["totals"];
      // A share must use the same full cohort, never divide two partial sums.
      const share = (key: "hookah" | "bar") =>
        totals.turnover.known === shifts.length &&
        totals[key].known === shifts.length &&
        totals.turnover.value !== null &&
        totals.turnover.value > 0
          ? rounded((totals[key].value! / totals.turnover.value) * 100)
          : null;
      return {
        month,
        shifts: shifts.length,
        preliminary: shifts.filter((d) => d.status === "preliminary").length,
        errors: shifts.filter((d) => !!d.sync_error).length,
        corrected: shifts.filter((d) => Object.keys(d.overrides).length > 0)
          .length,
        totals,
        hookahShare: share("hookah"),
        barShare: share("bar"),
        perShift:
          totals.turnover.value === null
            ? null
            : rounded(totals.turnover.value / totals.turnover.known),
      };
    });
}

export function monthBounds(month: string): { from: string; to: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Некорректный месяц");
  const [year, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, m, 0, 12)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${last}` };
}
