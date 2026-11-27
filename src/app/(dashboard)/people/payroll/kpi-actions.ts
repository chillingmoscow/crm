"use server";
import { z } from "zod";
import { actionResult } from "@/lib/actions/result";
import { kpiReason, kpiResult, parseKpiItems, type KpiAnswers, type KpiItem } from "@/lib/payroll/kpi";
import { loadKpiMonthView, type KpiMonthView } from "@/lib/payroll/kpi-month";
import { suggestAlcoholPlan } from "@/lib/sales/alcohol-plan";
import { payrollScope, type PayrollScope } from "./payroll-scope";

// KPI старших: вкладка «KPI» зарплаты и блок «KPI» в условиях должности.
// Итог считается здесь, на сервере, по условиям и плану из базы — клиенту не
// доверяем; запись, права, период и перенос проверяет база (миграция 410).

const MONTH = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/, "Проверьте месяц");
const monthStart = (m: string) => `${MONTH.parse(m)}-01`;

const access = (s: PayrollScope) => ({
  canSave: s.permissions.includes("payroll.review") || s.permissions.includes("payroll.pay"),
  canConfigure: s.permissions.includes("payroll.configure"),
});

async function viewScope() {
  const s = await payrollScope();
  if (!s.permissions.includes("payroll.view")) throw new Error("Нет доступа к зарплате");
  return s;
}

async function view(s: PayrollScope, month: string): Promise<KpiMonthView> {
  return loadKpiMonthView({ admin: s.admin, accountId: s.accountId, venueId: s.venueId }, month, access(s));
}

async function loadKpiMonthImpl(month: string): Promise<KpiMonthView> {
  const s = await viewScope();
  const m = monthStart(month);
  const result = await view(s, m);
  // Отчёт продаж за закончившийся месяц ставим в очередь сами: у того, кто
  // подводит KPI, может не быть права обновлять статистику.
  if (result.reportMissing && result.canSave && result.people.some((p) => p.items.some((i) => i.type === "plan"))) {
    const r = await s.db.rpc("payroll_kpi_request_alcohol", { p_month: m });
    if (r.error) console.error(`[kpi] отчёт продаж алкоголя за ${m}: ${r.error.message}`);
  }
  return result;
}

const answersSchema = z.record(z.string(), z.union([z.boolean(), z.number()]));

/** Только ответы на пункты условий: «Сделано» — да/нет, «За каждую» — число. */
function cleanAnswers(items: KpiItem[], raw: KpiAnswers): KpiAnswers {
  const out: KpiAnswers = {};
  for (const item of items) {
    const value = raw[item.id];
    if (item.type === "done") out[item.id] = value === true;
    if (item.type === "each") out[item.id] = typeof value === "number" ? value : 0;
  }
  return out;
}

async function saveKpiReviewImpl(input: { employeeId: string; month: string; termsId: string; answers: KpiAnswers; requestKey: string }) {
  const s = await viewScope();
  if (!access(s).canSave) throw new Error("Нет доступа к итогам KPI");
  const parsed = z.object({
    employeeId: z.string().uuid(),
    month: MONTH,
    termsId: z.string().uuid(),
    answers: answersSchema,
    requestKey: z.string().uuid(),
  }).parse(input);
  const m = `${parsed.month}-01`;
  const current = await view(s, m);
  if (current.blocked) throw new Error(current.blocked);
  const person = current.people.find((p) => p.employeeId === parsed.employeeId);
  if (!person) throw new Error("Этот сотрудник не подводит KPI за этот месяц");
  if (person.blocked) throw new Error(person.blocked);
  if (person.termsId !== parsed.termsId) throw new Error("Условия KPI изменились. Обновите страницу");
  const answers = cleanAnswers(person.items, parsed.answers);
  const { lines, total } = kpiResult(person.items, answers, current.plan);
  const r = await s.db.rpc("payroll_kpi_save", {
    p_input: {
      request_key: parsed.requestKey,
      employee_id: person.employeeId,
      month: m,
      terms_id: person.termsId,
      answers,
      lines,
      total,
      reason: kpiReason(m, lines),
    },
  });
  if (r.error) throw new Error(r.error.message);
  return view(s, m);
}

async function saveAlcoholPlanImpl(input: { viewMonth: string; target: "this" | "next"; amount: number | null; priceIncreasePercent: number | null }) {
  const s = await viewScope();
  const parsed = z.object({
    viewMonth: MONTH,
    target: z.enum(["this", "next"]),
    amount: z.number().finite().positive("План должен быть больше нуля").lt(1e12, "Слишком большая сумма").nullable(),
    priceIncreasePercent: z.number().finite().min(0.1, "Повышение цен — от 0,1 до 100%").max(100, "Повышение цен — от 0,1 до 100%").nullable(),
  }).parse(input);
  const m = `${parsed.viewMonth}-01`;
  // Месяц плана и предложение — с сервера: план этого месяца или следующего
  // за месяцем итогов, предложение пересчитываем по истории, а не берём из браузера.
  const current = await view(s, m);
  const month = parsed.target === "this" ? m : current.next.month;
  const suggested = suggestAlcoholPlan(new Map(current.next.history), month, parsed.priceIncreasePercent).amount;
  const r = await s.db.rpc("sales_alcohol_plan_save", {
    p_month: month,
    p_input: {
      alcohol: parsed.amount === null ? null : Math.round(parsed.amount * 100) / 100,
      suggested,
      price_increase_percent: parsed.amount === null ? null : parsed.priceIncreasePercent,
    },
  });
  if (r.error) throw new Error(r.error.message);
  return view(s, m);
}

export type KpiTermsVersion = { id: string; valid_from: string; items: KpiItem[]; change_reason: string; created_at: string; created_by: string | null };

async function loadKpiTermsImpl(roleId: string): Promise<{ versions: KpiTermsVersion[]; canConfigure: boolean }> {
  const s = await payrollScope();
  if (!s.permissions.includes("payroll.view") && !s.permissions.includes("payroll.configure"))
    throw new Error("Нет доступа к условиям оплаты");
  z.string().uuid().parse(roleId);
  const r = await s.admin
    .from<{ id: string; valid_from: string; items: unknown; change_reason: string; created_at: string; created_by: string | null }[]>("payroll_kpi_terms")
    .select("id,valid_from,items,change_reason,created_at,created_by")
    .eq("account_id", s.accountId).eq("venue_id", s.venueId).eq("role_id", roleId)
    .order("valid_from", { ascending: false }).order("created_at", { ascending: false });
  if (r.error) throw new Error("Не удалось загрузить условия KPI");
  const authors = [...new Set((r.data ?? []).map((v) => v.created_by).filter((x): x is string => Boolean(x)))];
  const names = authors.length
    ? new Map(((await s.admin.from<{ id: string; first_name: string | null; last_name: string | null }[]>("profiles")
        .select("id,first_name,last_name").in("id", authors)).data ?? [])
        .map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(" ") || "Сотрудник"]))
    : new Map<string, string>();
  return {
    canConfigure: s.permissions.includes("payroll.configure"),
    versions: (r.data ?? []).flatMap((v) => {
      try {
        return [{ ...v, items: parseKpiItems(v.items), created_by: v.created_by ? names.get(v.created_by) ?? null : null }];
      } catch {
        return [];
      }
    }),
  };
}

async function saveKpiTermsImpl(roleId: string, input: { valid_from: string; items: KpiItem[]; reason: string }, expectedId: string | null) {
  const s = await payrollScope("payroll.configure");
  z.string().uuid().parse(roleId);
  const validFrom = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])-01$/, "Условия KPI задаются с 1-го числа месяца").parse(input.valid_from);
  const reason = z.string().trim().min(3, "Укажите причину изменения условий").max(500, "Причина — до 500 символов").parse(input.reason);
  const items = parseKpiItems(input.items);
  const r = await s.db.rpc("payroll_kpi_terms_save", {
    p_role_id: roleId,
    p_input: { valid_from: validFrom, reason, items },
    p_expected_id: expectedId,
  });
  if (r.error) throw new Error(r.error.message);
  return null;
}

// Действия возвращают ошибку текстом, а не исключением (см. lib/actions/result).
export async function loadKpiMonth(month: string) {
  return actionResult(() => loadKpiMonthImpl(month), "Не удалось загрузить KPI");
}
export async function saveKpiReview(input: { employeeId: string; month: string; termsId: string; answers: KpiAnswers; requestKey: string }) {
  return actionResult(() => saveKpiReviewImpl(input), "Не удалось сохранить итоги KPI");
}
export async function saveAlcoholPlan(input: { viewMonth: string; target: "this" | "next"; amount: number | null; priceIncreasePercent: number | null }) {
  return actionResult(() => saveAlcoholPlanImpl(input), "Не удалось сохранить план продаж");
}
export async function loadKpiTerms(roleId: string) {
  return actionResult(() => loadKpiTermsImpl(roleId), "Не удалось загрузить условия KPI");
}
export async function saveKpiTerms(roleId: string, input: { valid_from: string; items: KpiItem[]; reason: string }, expectedId: string | null) {
  return actionResult(() => saveKpiTermsImpl(roleId, input, expectedId), "Не удалось сохранить условия KPI");
}
