import {
  defaultAdditionalRules,
  type AdditionalArchive,
  type AdditionalDay,
  type AdditionalKind,
  type AdditionalMetrics,
  type AdditionalRules,
} from "./additional.ts";
import {
  dayContext,
  type DayArchive,
  type DayContextValue,
  type DayReference,
} from "./day-context.ts";
import type { UpsellDayResult, UpsellLine } from "./upsell.ts";

/** Показатели строки: у дня по чекам прибавка или выручка могут быть неизвестны. */
export type AdditionalRowMetrics = Omit<
  AdditionalMetrics,
  "revenue" | "primeCost" | "bonus"
> & { revenue: number | null; primeCost: number | null; bonus: number | null };
export type UpsellViewDay = {
  id: string;
  department_id: string;
  business_date: string;
  state: "pending" | "running" | "ready" | "error";
  result: UpsellDayResult | null;
  last_error: string | null;
  computed_at: string | null;
};
export type AdditionalRow = {
  id: string;
  date: string;
  /** Старый вид отчёта подразделения; null — у подразделения его нет. */
  kind: AdditionalKind | null;
  metrics: AdditionalRowMetrics | null;
  rules: AdditionalRules;
  native?: AdditionalDay;
  archive?: AdditionalArchive;
  /**
   * День новой схемы (с даты перехода подразделения). `day` — расчёт по
   * чекам (null — дня ещё нет в очереди), `lines` — строки версии правил на
   * дату, `report` — отчёт Quick Resto того же дня, источник выручки.
   */
  upsell?: {
    departmentId: string;
    day: UpsellViewDay | null;
    lines: UpsellLine[];
    report?: AdditionalDay;
  };
  context?: DayContextValue;
};
/** Что нужно экрану «Допродажи»; `AdditionalData` из actions подходит. */
export type AdditionalViewData = {
  venueId: string;
  reports: AdditionalDay[];
  archives: AdditionalArchive[];
  days: DayReference[];
  dayArchives: DayArchive[];
  departments: { id: string; name: string; legacyKind: AdditionalKind | null }[];
  /** Версии правил, `valid_from desc, created_at desc`. */
  upsellRules: {
    id: string;
    department_id: string;
    valid_from: string;
    created_at: string;
    lines: UpsellLine[];
  }[];
  upsellDays: UpsellViewDay[];
};
export type AdditionalTab = {
  id: string;
  name: string;
  legacyKind: AdditionalKind | null;
  /** Первый день расчёта по чекам; null — правил нового вида нет. */
  switchDate: string | null;
};
const LEGACY_NAMES: Record<AdditionalKind, string> = {
  bar: "Бар",
  masters: "Кальяны",
};
const LEGACY_PREFIX = "legacy:";

/** Первый день расчёта подразделения по чекам — самая ранняя версия правил. */
export function upsellSwitchDate(
  data: Pick<AdditionalViewData, "upsellRules">,
  departmentId: string,
): string | null {
  let first: string | null = null;
  for (const v of data.upsellRules)
    if (v.department_id === departmentId && (first === null || v.valid_from < first))
      first = v.valid_from;
  return first;
}

/**
 * Вкладки экрана: подразделения со старым видом отчётов или с правилами
 * нового вида. Подразделение без того и другого в допродажах не участвует.
 * Старый вид с данными, не связанный ни с одним подразделением (нет
 * подразделения «Бар»), остаётся отдельной вкладкой, чтобы история не пропала.
 */
export function additionalTabs(data: AdditionalViewData): AdditionalTab[] {
  const tabs: AdditionalTab[] = data.departments
    .map((d) => ({
      id: d.id,
      name: d.name,
      legacyKind: d.legacyKind,
      switchDate: upsellSwitchDate(data, d.id),
    }))
    .filter((t) => t.legacyKind !== null || t.switchDate !== null);
  for (const kind of ["bar", "masters"] as const)
    if (
      !data.departments.some((d) => d.legacyKind === kind) &&
      (data.reports.some((r) => r.kind === kind) ||
        data.archives.some((r) => r.kind === kind))
    )
      tabs.push({
        id: LEGACY_PREFIX + kind,
        name: LEGACY_NAMES[kind],
        legacyKind: kind,
        switchDate: null,
      });
  return tabs;
}

/** Строки версии правил подразделения, действующей на дату. */
function upsellLinesFor(
  data: Pick<AdditionalViewData, "upsellRules">,
  departmentId: string,
  date: string,
): UpsellLine[] {
  let best: AdditionalViewData["upsellRules"][number] | null = null;
  for (const v of data.upsellRules)
    if (
      v.department_id === departmentId &&
      v.valid_from <= date &&
      (!best ||
        v.valid_from > best.valid_from ||
        (v.valid_from === best.valid_from && v.created_at > best.created_at))
    )
      best = v;
  return best?.lines ?? [];
}

/** Результат дня, которому можно верить: пересчитываемый день — «нет данных». */
export function readyUpsellResult(day: UpsellViewDay | null | undefined) {
  return day?.state === "ready" ? day.result : null;
}

/**
 * Дни подразделения: до даты перехода — старая очередь его вида (как
 * `additionalRows`, вместе с архивом Glide для дней без отчёта), с даты
 * перехода — расчёт по чекам. Выручка и себестоимость дня новой схемы — из
 * отчёта Quick Resto того же дня.
 */
export function departmentRows(
  data: AdditionalViewData,
  departmentId: string,
): AdditionalRow[] {
  const kind = departmentId.startsWith(LEGACY_PREFIX)
    ? (departmentId.slice(LEGACY_PREFIX.length) as AdditionalKind)
    : (data.departments.find((d) => d.id === departmentId)?.legacyKind ?? null);
  const legacy = kind ? additionalRows(data.reports, data.archives, kind, data) : [];
  const switchDate = upsellSwitchDate(data, departmentId);
  if (switchDate === null) return legacy;
  const reportByDate = new Map(
    data.reports.filter((r) => r.kind === kind).map((r) => [r.business_date, r]),
  );
  const dayByDate = new Map(
    data.upsellDays
      .filter((d) => d.department_id === departmentId && d.business_date >= switchDate)
      .map((d) => [d.business_date, d]),
  );
  const dates = new Set([
    ...dayByDate.keys(),
    ...[...reportByDate.keys()].filter((d) => d >= switchDate),
  ]);
  const fresh: AdditionalRow[] = [...dates].map((date) => {
    const day = dayByDate.get(date) ?? null,
      report = reportByDate.get(date),
      result = readyUpsellResult(day);
    return {
      id: day?.id ?? `${departmentId}:${date}`,
      date,
      kind,
      metrics: {
        revenue: report?.metrics?.revenue ?? null,
        primeCost: report?.metrics?.primeCost ?? null,
        bonus: result ? result.bonus : null,
        points: null,
        quantities: result
          ? Object.fromEntries(result.lines.map((l) => [l.key, l.quantity]))
          : {},
      },
      rules: defaultAdditionalRules,
      upsell: {
        departmentId,
        day,
        lines: upsellLinesFor(data, departmentId, date),
        report,
      },
      context: dayContext(data.venueId, date, "native", data.days, data.dayArchives),
    };
  });
  return [...legacy.filter((r) => r.date < switchDate), ...fresh].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
}

/** Позиции чеков не из номенклатуры по готовым дням, количества сложены. */
export function upsellUnknown(rows: AdditionalRow[]) {
  const sum = new Map<string, number>();
  for (const r of rows)
    for (const u of readyUpsellResult(r.upsell?.day)?.unknown ?? [])
      sum.set(u.key, Math.round(((sum.get(u.key) ?? 0) + u.quantity) * 1e8) / 1e8);
  return [...sum.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, quantity]) => ({ key, quantity }));
}
/**
 * Дни старого вида: отчёты Quick Resto, а дни, где отчёта с показателями нет,
 * — из архива Glide (последний снимок дня). Архив подставляется сам, без
 * переключателя: он есть только за месяцы до расчёта Sheerly.
 */
export function additionalRows(
  reports: AdditionalDay[],
  archives: AdditionalArchive[],
  kind: AdditionalKind,
  context?: {
    venueId: string;
    days: DayReference[];
    dayArchives: DayArchive[];
  },
): AdditionalRow[] {
  const native: AdditionalRow[] = reports
    .filter((r) => r.kind === kind)
    .map((r) => ({
      id: r.id,
      date: r.business_date,
      kind,
      metrics: r.metrics,
      rules: (r.metrics_request ?? r.request).rules,
      native: r,
      context: context
        ? dayContext(context.venueId, r.business_date, "native", context.days, context.dayArchives)
        : undefined,
    }));
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
  const withMetrics = new Set(native.filter((r) => r.metrics).map((r) => r.date));
  const fromArchive: AdditionalRow[] = [...latest.values()]
    .filter((r) => !withMetrics.has(r.business_date))
    .map((r) => ({
      id: r.id,
      date: r.business_date,
      kind,
      metrics: r.metrics,
      rules: defaultAdditionalRules,
      archive: r,
      context: context
        ? dayContext(
            context.venueId,
            r.business_date,
            "archive",
            context.days,
            context.dayArchives,
            r.origin.legacy_shift_id,
          )
        : undefined,
    }));
  const archived = new Set(fromArchive.map((r) => r.date));
  return [...native.filter((r) => !archived.has(r.date)), ...fromArchive].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
}
export function additionalValue(r: AdditionalRow, key: string): number | null {
  if (key === "turnover") return r.context?.turnover ?? null;
  if (!r.metrics) return null;
  if (key in r.metrics && key !== "quantities")
    return r.metrics[key as Exclude<keyof AdditionalRowMetrics, "quantities">];
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

export function additionalNeedsRefresh(
  reports: Pick<AdditionalDay, "business_date" | "state">[],
  month: string,
) {
  return reports.some(
    (r) => r.business_date.startsWith(month.slice(0, 7)) && r.state !== "ready",
  );
}
