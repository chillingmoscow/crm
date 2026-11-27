import "server-only";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { LooseDb } from "@/lib/supabase/loose";
import { businessDate } from "@/lib/sales/time";
import { alcoholActual, alcoholHistory, suggestAlcoholPlan, type AlcoholReport, type AlcoholSuggestion } from "@/lib/sales/alcohol-plan";
import { kpiNeedsRecount, kpiPeople, parseKpiItems, type KpiAnswers, type KpiItem, type KpiLine, type KpiPlanFact } from "./kpi";
import { transferMonthLabel } from "./transfer-reason";
import type { PayAssignment, PayEmployee, PayModel } from "./types";

// Данные вкладки «KPI» за месяц: кому подводить итоги, условия, план и факт
// продаж алкоголя, подсказки. Читает серверным клиентом после проверки прав —
// тот же набор нужен утренней проверке, у которой нет пользователя.

export type KpiVenue = { admin: LooseDb; accountId: string; venueId: string };

export type KpiMonthPerson = {
  employeeId: string;
  name: string;
  roleName: string;
  since: string | null;
  termsId: string;
  items: KpiItem[];
  review: {
    answers: KpiAnswers;
    total: number;
    savedAt: string;
    savedBy: string | null;
    /** Сохранили, пока отчёта продаж не было: план надо досчитать. */
    needsRecount: boolean;
  } | null;
  /** Ручные надбавки и премии за месяц с названием должности в основании — риск заплатить дважды. */
  manual: { amount: number; reason: string }[];
  /** Почему итог сейчас не сохранить (перенесён остаток). */
  blocked: string | null;
};

export type KpiMonthView = {
  month: string;
  canSave: boolean;
  canConfigure: boolean;
  /** Почему итоги месяца сейчас не сохранить: месяц не закончился, период зафиксирован. */
  blocked: string | null;
  people: KpiMonthPerson[];
  plan: KpiPlanFact;
  /** Отчёт продаж алкоголя за месяц ещё не готов, а месяц закончился. */
  reportMissing: boolean;
  inventory: { date: string; count: number; beforeDeadline: boolean }[];
  next: {
    month: string;
    current: number | null;
    priceIncreasePercent: number | null;
    suggestion: AlcoholSuggestion;
    history: [string, number][];
  };
};

const shift = (month: string, by: number) => {
  const d = new Date(`${month.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 10);
};
const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

function check<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

type TermsRow = { id: string; role_id: string; valid_from: string; items: unknown };
type ReviewRow = { employee_id: string; answers: KpiAnswers; lines: KpiLine[]; total: number; saved_at: string; saved_by: string | null };

/** Люди и условия месяца — общая часть для вкладки и утренней проверки. */
export async function kpiMonthPeople(s: KpiVenue, month: string) {
  const { admin, accountId, venueId } = s;
  const scoped = <T>(name: string, columns = "*") =>
    fetchAllRows<T>(() => admin.from<T[]>(name).select(columns).eq("account_id", accountId).eq("venue_id", venueId));
  const end = dayBefore(shift(month, 1));
  const [employees, assignments, models, terms, reviews, accrued, settings] = await Promise.all([
    scoped<PayEmployee>("payroll_employees"),
    scoped<PayAssignment>("payroll_employee_models", "id,employee_id,model_id,valid_from"),
    scoped<PayModel>("payroll_models"),
    scoped<TermsRow>("payroll_kpi_terms", "id,role_id,valid_from,items"),
    admin.from<ReviewRow[]>("payroll_kpi_reviews").select("employee_id,answers,lines,total,saved_at,saved_by")
      .eq("account_id", accountId).eq("venue_id", venueId).eq("month", month),
    fetchAllRows<{ employee_id: string }>(() =>
      admin.from<{ employee_id: string }[]>("payroll_accruals").select("employee_id")
        .eq("account_id", accountId).eq("venue_id", venueId).gte("business_date", month).lte("business_date", end)),
    admin.from<{ starts_on: string }>("payroll_settings").select("starts_on").eq("account_id", accountId).eq("venue_id", venueId).maybeSingle(),
  ]);
  const startsOn = check(settings)?.starts_on ?? null;
  const people = !startsOn || month < `${startsOn.slice(0, 7)}-01`
    ? []
    : kpiPeople(employees, assignments, models, terms, month, new Set(accrued.map((a) => a.employee_id)));
  return {
    people,
    employees: new Map(employees.map((e) => [e.id, e])),
    terms: new Map(terms.map((t) => [t.id, t])),
    reviews: new Map(check(reviews).map((r) => [r.employee_id, r])),
    anyTerms: terms.length > 0,
  };
}

/** Есть ли в действующих на месяц условиях пункт плана продаж алкоголя. */
export function termsWithPlan(terms: Map<string, TermsRow>, termsIds: string[]): boolean {
  return termsIds.some((id) => {
    const t = terms.get(id);
    return Array.isArray(t?.items) && t.items.some((i) => (i as { type?: string }).type === "plan");
  });
}

/** План и факт продаж алкоголя, история для предложения. */
export async function alcoholMonth(s: KpiVenue, month: string) {
  const { admin, accountId, venueId } = s;
  const [plans, reports, archive] = await Promise.all([
    admin.from<{ month: string; alcohol: number | null; price_increase_percent: number | null }[]>("sales_month_plans")
      .select("month,alcohol,price_increase_percent").eq("account_id", accountId).eq("venue_id", venueId)
      .in("month", [month, shift(month, 1)]),
    admin.from<{ month: string; metrics: { revenue?: number } | null; through_date: string | null; state: string }[]>("sales_month_reports")
      .select("month,metrics,through_date,state").eq("account_id", accountId).eq("venue_id", venueId).eq("kind", "alcohol"),
    admin.from<{ month: string; metrics: { alcoholRevenue?: number } | null }[]>("sales_statistics_archive")
      .select("month,metrics").eq("account_id", accountId).eq("venue_id", venueId),
  ]);
  const planRows = check(plans) ?? [];
  const reportRows: AlcoholReport[] = (check(reports) ?? []).map((r) => ({
    month: r.month.slice(0, 10),
    revenue: typeof r.metrics?.revenue === "number" ? r.metrics.revenue : null,
    through_date: r.through_date,
    state: r.state,
  }));
  const history = alcoholHistory(
    reportRows,
    (check(archive) ?? []).map((a) => ({
      month: a.month.slice(0, 10),
      alcoholRevenue: typeof a.metrics?.alcoholRevenue === "number" ? a.metrics.alcoholRevenue : null,
    })),
  );
  const own = planRows.find((p) => p.month.slice(0, 10) === month);
  const next = planRows.find((p) => p.month.slice(0, 10) === shift(month, 1));
  return {
    plan: {
      target: own?.alcohol != null ? Number(own.alcohol) : null,
      actual: alcoholActual(reportRows.find((r) => r.month === month) ?? null, month),
    } satisfies KpiPlanFact,
    next: {
      current: next?.alcohol != null ? Number(next.alcohol) : null,
      priceIncreasePercent: next?.price_increase_percent != null ? Number(next.price_increase_percent) : null,
    },
    history,
  };
}

export async function loadKpiMonthView(
  s: KpiVenue,
  month: string,
  access: { canSave: boolean; canConfigure: boolean },
): Promise<KpiMonthView> {
  const { admin, accountId, venueId } = s;
  const end = dayBefore(shift(month, 1));
  const [base, alcohol, adjustments, documents, period, carried, venue, hours] = await Promise.all([
    kpiMonthPeople(s, month),
    alcoholMonth(s, month),
    fetchAllRows<{ employee_id: string; kind: string; amount: number; reason: string; origin: string | null; deleted_at: string | null }>(() =>
      admin.from<{ employee_id: string; kind: string; amount: number; reason: string; origin: string | null; deleted_at: string | null }[]>("payroll_adjustments")
        .select("employee_id,kind,amount,reason,origin,deleted_at")
        .eq("account_id", accountId).eq("venue_id", venueId).gte("business_date", month).lte("business_date", end)
        .in("kind", ["allowance", "bonus"])),
    admin.from<{ invoice_date: string }[]>("documents").select("invoice_date")
      .eq("account_id", accountId).eq("venue_id", venueId).eq("document_kind", "inventory").eq("processed", true)
      // Дата акта — момент (timestamptz): берём с запасом в сутки и режем по дню заведения ниже.
      .is("archived_at", null).gte("invoice_date", dayBefore(month)).lt("invoice_date", `${shift(month, 1)}T23:59:59Z`),
    admin.from<{ status: string }>("payroll_periods").select("status").eq("account_id", accountId).eq("venue_id", venueId).eq("month", month).maybeSingle(),
    admin.from<{ id: string }[]>("payroll_payout_plans").select("id")
      .eq("account_id", accountId).eq("venue_id", venueId).eq("month", month).eq("payout_no", 2).not("carried_at", "is", null),
    admin.from<{ timezone: string }>("venues").select("timezone").eq("id", venueId).single(),
    admin.from<{ day_start_hour: number }>("sales_settings").select("day_start_hour").eq("account_id", accountId).eq("venue_id", venueId).maybeSingle(),
  ]);
  const carriedPlans = (check(carried) ?? []).map((p) => p.id);
  const carriedRows = carriedPlans.length
    ? check(await admin.from<{ employee_id: string }[]>("payroll_payout_rows").select("employee_id").in("plan_id", carriedPlans)) ?? []
    : [];
  const carriedIds = new Set(carriedRows.map((r) => r.employee_id));
  const timezone = check(venue)?.timezone ?? "Europe/Moscow";
  const today = businessDate(new Date(), timezone, check(hours)?.day_start_hour ?? 9);
  const label = transferMonthLabel(month);
  const nextLabel = transferMonthLabel(shift(month, 1));
  const blocked = today < shift(month, 1)
    ? `Итоги за ${label} подводятся с 1-го числа следующего месяца`
    : check(period) && check(period)!.status !== "draft"
      ? "Период зафиксирован. Итоги KPI за этот месяц менять нельзя"
      : null;

  const savers = [...base.reviews.values()].map((r) => r.saved_by).filter((x): x is string => Boolean(x));
  const names = savers.length
    ? new Map((check(await admin.from<{ id: string; first_name: string | null; last_name: string | null }[]>("profiles")
        .select("id,first_name,last_name").in("id", [...new Set(savers)])) ?? [])
        .map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(" ") || "Сотрудник"]))
    : new Map<string, string>();
  const roleIds = [...new Set(base.people.map((p) => p.roleId))];
  const roles = roleIds.length
    ? new Map((check(await admin.from<{ id: string; name: string }[]>("roles").select("id,name").in("id", roleIds)) ?? []).map((r) => [r.id, r.name]))
    : new Map<string, string>();

  const people: KpiMonthPerson[] = base.people.flatMap((p) => {
    const employee = base.employees.get(p.employeeId);
    const terms = base.terms.get(p.termsId);
    if (!employee || !terms) return [];
    let items: KpiItem[];
    try {
      items = parseKpiItems(terms.items);
    } catch {
      return [];
    }
    const roleName = roles.get(p.roleId) ?? employee.role_name;
    const review = base.reviews.get(p.employeeId);
    const needle = roleName.toLowerCase();
    return [{
      employeeId: p.employeeId,
      name: employee.name,
      roleName,
      since: p.since,
      termsId: p.termsId,
      items,
      review: review
        ? {
            answers: review.answers,
            total: Number(review.total),
            savedAt: review.saved_at,
            savedBy: review.saved_by ? names.get(review.saved_by) ?? null : null,
            needsRecount: kpiNeedsRecount(Array.isArray(review.lines) ? review.lines : []),
          }
        : null,
      manual: adjustments
        .filter((a) => a.employee_id === p.employeeId && a.origin !== "kpi" && !a.deleted_at && Number(a.amount) > 0 &&
          (a.kind === "allowance" || a.reason.toLowerCase().includes(needle)))
        .map((a) => ({ amount: Number(a.amount), reason: a.reason })),
      blocked: carriedIds.has(p.employeeId) ? `Остаток за ${label} уже перенесён — поправку внесите премией за ${nextLabel}` : null,
    }];
  });

  const byDate = new Map<string, number>();
  for (const d of check(documents) ?? []) {
    // День акта — по часам заведения: 22.11 20:08 UTC в Москве уже 23-е.
    const date = new Date(d.invoice_date).toLocaleDateString("en-CA", { timeZone: timezone });
    if (date.slice(0, 7) !== month.slice(0, 7)) continue;
    byDate.set(date, (byDate.get(date) ?? 0) + 1);
  }
  const deadline = `${month.slice(0, 7)}-20`;
  const nextMonth = shift(month, 1);
  return {
    month,
    canSave: access.canSave,
    canConfigure: access.canConfigure,
    blocked,
    people,
    plan: alcohol.plan,
    reportMissing: today >= nextMonth && alcohol.plan.actual === null,
    inventory: [...byDate.entries()].sort().map(([date, count]) => ({ date, count, beforeDeadline: date <= deadline })),
    next: {
      month: nextMonth,
      current: alcohol.next.current,
      priceIncreasePercent: alcohol.next.priceIncreasePercent,
      suggestion: suggestAlcoholPlan(alcohol.history, nextMonth, alcohol.next.priceIncreasePercent),
      history: [...alcohol.history.entries()],
    },
  };
}
