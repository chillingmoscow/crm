import "server-only";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { LooseDb } from "@/lib/supabase/loose";
import { businessDate } from "./time";
import { effectiveMetrics, type SalesDay } from "./types";
import { statisticsRevenueShare } from "./statistics-view";
import type { StatisticsReport } from "./statistics-reports";
import { forecastShare, forecastTurnover, shiftMonth, type Forecast, type MonthKey, type PriceChange, type SeasonIndex } from "./forecast";
import { INDUSTRY_SEASONALITY, ownSeasonIndex, parseSeasonIndex } from "./seasonality";
import { alcoholShareStatus } from "./alcohol-plan";

// План месяца (дизайн 2026-11-27-sales-plan-forecast-kpi-v2): ряды оборота и
// доли алкоголя по месяцам, журнал цен, сезонность — и прогноз на месяц.
// Читает серверным клиентом после проверки прав вызывающим.

export type PlanVenue = { admin: LooseDb; accountId: string; venueId: string; permissions: string[] };
export type PriceChangeRow = PriceChange & { id: string; note: string };

export type MonthPlanView = {
  month: MonthKey;
  canEdit: boolean;
  turnover: { plan: number | null; fact: number | null; forecast: Forecast };
  alcoholShare: { plan: number | null; fact: number | null; pending: "month" | "report" | null; forecast: Forecast; frozen: boolean };
  prices: PriceChangeRow[];
  season: { index: SeasonIndex; custom: boolean; industry: SeasonIndex; own: (number | null)[]; source: string; note: string };
};

type DayRow = Pick<SalesDay, "venue_id" | "business_date" | "status" | "calculated" | "overrides"> & { settings: unknown };

const daysIn = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();

function check<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

/** Все исходные данные заведения для плана — одной волной. */
export async function loadPlanSources(s: PlanVenue) {
  const { admin, accountId, venueId } = s;
  const [days, reports, archive, plans, prices, season, venue, settings] = await Promise.all([
    // Только нужные поля: история за годы, а экран открывают часто.
    fetchAllRows<DayRow>(() => admin.from<DayRow[]>("sales_days")
      .select("venue_id,business_date,status,calculated,overrides,settings:source_summary->settings")
      .eq("account_id", accountId).eq("venue_id", venueId)),
    admin.from<StatisticsReport[]>("sales_month_reports")
      .select("id,venue_id,month,kind,metrics,period_start,period_end,through_date,synced_at,state,last_error")
      .eq("account_id", accountId).eq("venue_id", venueId).eq("kind", "alcohol"),
    admin.from<{ month: string; metrics: Record<string, number | null> | null }[]>("sales_statistics_archive")
      .select("month,metrics").eq("account_id", accountId).eq("venue_id", venueId),
    admin.from<{ month: string; turnover: number | null; alcohol_share: number | null }[]>("sales_month_plans")
      .select("month,turnover,alcohol_share").eq("account_id", accountId).eq("venue_id", venueId),
    admin.from<{ id: string; effective_on: string; percent: number; note: string }[]>("sales_price_changes")
      .select("id,effective_on,percent,note").eq("account_id", accountId).eq("venue_id", venueId).order("effective_on"),
    admin.from<{ index: unknown }>("sales_seasonality").select("index").eq("account_id", accountId).eq("venue_id", venueId).maybeSingle(),
    admin.from<{ timezone: string }>("venues").select("timezone").eq("id", venueId).single(),
    admin.from<{ day_start_hour: number }>("sales_settings").select("day_start_hour").eq("account_id", accountId).eq("venue_id", venueId).maybeSingle(),
  ]);
  const timezone = check(venue)?.timezone ?? "Europe/Moscow";
  const hour = check(settings)?.day_start_hour ?? 9;
  let custom: SeasonIndex | null = null;
  try {
    custom = check(season) ? parseSeasonIndex(check(season)!.index) : null;
  } catch {
    custom = null;
  }
  return {
    // statisticsRevenueShare сверяет рабочий период по source_summary.settings.
    days: days.map((d) => ({ ...d, source_summary: { settings: d.settings } }) as unknown as SalesDay),
    reports: check(reports) ?? [],
    archive: check(archive) ?? [],
    plans: new Map((check(plans) ?? []).map((p) => [p.month.slice(0, 10), p])),
    prices: (check(prices) ?? []).map((p) => ({ id: p.id, date: p.effective_on, percent: Number(p.percent), note: p.note })),
    custom,
    timezone,
    hour,
    today: businessDate(new Date(), timezone, hour),
  };
}
export type PlanSources = Awaited<ReturnType<typeof loadPlanSources>>;

/** Помесячные ряды: оборот (полный месяц — все дни, без предварительных) и доля алкоголя. */
export function planSeries(src: PlanSources) {
  const turnover = new Map<MonthKey, number>();
  const complete = new Set<MonthKey>();
  const byMonth = new Map<MonthKey, SalesDay[]>();
  for (const d of src.days) {
    const m = `${d.business_date.slice(0, 7)}-01`;
    byMonth.set(m, [...(byMonth.get(m) ?? []), d]);
  }
  const currentMonth = `${src.today.slice(0, 7)}-01`;
  for (const [m, list] of byMonth) {
    const values = list.map((d) => effectiveMetrics(d).turnover).filter((v): v is number => v !== null && Number.isFinite(v));
    const sum = values.reduce((s, v) => s + v, 0);
    turnover.set(m, sum);
    // Нулевой «полный» месяц — пустая догрузка, а не продажи: в базы не идёт.
    if (m < currentMonth && sum > 0 && list.length === daysIn(m) && values.length === list.length && !list.some((d) => d.status === "preliminary"))
      complete.add(m);
  }
  // Архив Glide — запасной источник месяца, где свои дни неполные или их нет.
  for (const a of src.archive) {
    const m = `${a.month.slice(0, 7)}-01`;
    const v = a.metrics?.turnover;
    if (!complete.has(m) && typeof v === "number" && v > 0 && m < currentMonth) {
      turnover.set(m, v);
      complete.add(m);
    }
  }
  const share = new Map<MonthKey, number>();
  const shareComplete = new Set<MonthKey>();
  for (const r of src.reports) {
    const m = `${r.month.slice(0, 7)}-01`;
    const value = statisticsRevenueShare(r, src.days, src.timezone, src.hour).value;
    if (value === null || !Number.isFinite(value)) continue;
    share.set(m, value);
    if (m < currentMonth && r.state === "ready" && r.through_date && r.through_date.slice(0, 10) >= `${m.slice(0, 8)}${daysIn(m)}`) shareComplete.add(m);
  }
  for (const a of src.archive) {
    const m = `${a.month.slice(0, 7)}-01`;
    const v = a.metrics?.alcoholShare;
    if (!shareComplete.has(m) && typeof v === "number" && v > 0 && m < currentMonth) {
      share.set(m, v);
      shareComplete.add(m);
    }
  }
  // Веса дней недели: средний оборот дня недели за последний год своих дней.
  const since = shiftMonth(currentMonth, -12);
  const sums = Array(7).fill(0), counts = Array(7).fill(0);
  for (const d of src.days) {
    const v = effectiveMetrics(d).turnover;
    if (d.business_date < since || v === null || !Number.isFinite(v) || d.status === "preliminary") continue;
    const wd = (new Date(`${d.business_date}T12:00:00Z`).getUTCDay() + 6) % 7;
    sums[wd] += v;
    counts[wd] += 1;
  }
  const avg = sums.map((s, i) => (counts[i] ? s / counts[i] : 0));
  const known = avg.filter((v) => v > 0);
  const overall = known.length ? known.reduce((s, v) => s + v, 0) / known.length : 0;
  const weekdayWeights = avg.map((v) => (v > 0 && overall > 0 ? v / overall : 1));
  return { turnover, complete, share, shareComplete, weekdayWeights };
}

export async function loadMonthPlanView(s: PlanVenue, month: MonthKey): Promise<MonthPlanView> {
  const src = await loadPlanSources(s);
  const series = planSeries(src);
  const seasonIndex = src.custom ?? INDUSTRY_SEASONALITY.index;
  const own = ownSeasonIndex(src.days.flatMap((d) => {
    const v = effectiveMetrics(d).turnover;
    return v === null || !Number.isFinite(v) || d.status === "preliminary" ? [] : [{ date: d.business_date, turnover: v }];
  }), `${src.today.slice(0, 7)}-01`);
  const plan = src.plans.get(month);
  const report = src.reports.find((r) => r.month.slice(0, 10) === month);
  const shareNow = report ? statisticsRevenueShare(report, src.days, src.timezone, src.hour).value : null;
  const status = alcoholShareStatus({
    month,
    today: src.today,
    report: report ? { state: report.state, through_date: report.through_date, revenue: report.metrics?.revenue ?? null } : null,
    share: shareNow,
  });
  const currentMonth = `${src.today.slice(0, 7)}-01`;
  const reviews = month < currentMonth
    ? check(await s.admin.from<{ id: string }[]>("payroll_kpi_reviews").select("id").eq("account_id", s.accountId).eq("venue_id", s.venueId).eq("month", month).limit(1))
    : [];
  return {
    month,
    canEdit: s.permissions.includes("sales.plan"),
    turnover: {
      plan: plan?.turnover != null ? Number(plan.turnover) : null,
      fact: series.turnover.get(month) ?? null,
      forecast: forecastTurnover({
        target: month, turnover: series.turnover, complete: series.complete,
        prices: src.prices, season: seasonIndex, weekdayWeights: series.weekdayWeights,
      }),
    },
    alcoholShare: {
      plan: plan?.alcohol_share != null ? Number(plan.alcohol_share) : null,
      // В идущем месяце показываем долю на сейчас; для KPI засчитывается только итоговая.
      fact: status.actual ?? shareNow,
      pending: status.pending,
      forecast: forecastShare({ target: month, share: series.share, complete: series.shareComplete }),
      frozen: (reviews ?? []).length > 0,
    },
    prices: src.prices,
    season: {
      index: seasonIndex,
      custom: src.custom !== null,
      industry: INDUSTRY_SEASONALITY.index,
      own,
      source: INDUSTRY_SEASONALITY.source,
      note: INDUSTRY_SEASONALITY.note,
    },
  };
}

/** План и выполнение по месяцам — для столбцов таблицы «Статистики». */
export async function loadPlanSummary(s: PlanVenue): Promise<{ month: MonthKey; turnover: number | null; alcoholShare: number | null }[]> {
  const r = await s.admin.from<{ month: string; turnover: number | null; alcohol_share: number | null }[]>("sales_month_plans")
    .select("month,turnover,alcohol_share").eq("account_id", s.accountId).eq("venue_id", s.venueId);
  return (check(r) ?? []).map((p) => ({
    month: p.month.slice(0, 10),
    turnover: p.turnover != null ? Number(p.turnover) : null,
    alcoholShare: p.alcohol_share != null ? Number(p.alcohol_share) : null,
  }));
}
