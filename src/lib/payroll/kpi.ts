// KPI старших: пункты условий должности, итог месяца и основание премии.
// Чистые функции — их гоняет node --test; сервер считает итог ими же.

import { employeeAtDate } from "./calculate.ts";
import { transferMonthLabel } from "./transfer-reason.ts";
import type { PayAssignment, PayEmployee, PayModel } from "./types.ts";

export type KpiItem =
  | { id: string; type: "done"; label: string; amount: number }
  | { id: string; type: "each"; label: string; price: number }
  | { id: string; type: "plan"; label: string; amount: number; metric: "alcohol_share" }
  | { id: string; type: "all"; label: string; amount: number; requires: string[] };
export type KpiAnswers = Record<string, boolean | number>;
/**
 * План по доле алкоголя в очищенном обороте, %: `target` — план, `actual` — факт
 * за закончившийся месяц с полным отчётом. `pending` — почему факта пока нет.
 */
export type KpiPlanFact = { target: number | null; actual: number | null; pending?: "month" | "report" | null };
export type KpiLine = {
  id: string;
  label: string;
  type: KpiItem["type"];
  amount: number;
  counted: boolean;
  note: string | null;
};
export type KpiPerson = { employeeId: string; termsId: string; roleId: string; since: string | null };

/** С этого месяца KPI подводятся в приложении (решение Павла, 27.11.2026). */
export const KPI_START = "2026-11-01";
export const KPI_MAX_COUNT = 50;

/** Условия старшего бармена (слова Павла, 27.11.2026). Тот же набор — в сиде миграции 415. */
export const SENIOR_BAR: KpiItem[] = [
  { id: "inventory", type: "done", label: "Инвентаризация до 20-го", amount: 7000 },
  { id: "purchasing", type: "done", label: "Закупки алкоголя (кроме пива)", amount: 10000 },
  { id: "team_event", type: "done", label: "Командное мероприятие", amount: 3000 },
  { id: "all_three", type: "all", label: "Все три KPI", amount: 5000, requires: ["inventory", "purchasing", "team_event"] },
  { id: "alcohol_plan", type: "plan", label: "План продаж алкоголя", amount: 10000, metric: "alcohol_share" },
  { id: "seasonal", type: "each", label: "Сезонные позиции", price: 1000 },
];

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function money(value: unknown, label: string, what: string): number {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Пункт «${label}»: укажите ${what} больше нуля`);
  if (n > 1_000_000) throw new Error(`Пункт «${label}»: слишком большая сумма`);
  if (Math.round(n * 100) !== n * 100) throw new Error(`Пункт «${label}»: не больше двух знаков после запятой`);
  return n;
}

/** Проверка условий KPI: бросает Error с текстом для человека. */
export function parseKpiItems(raw: unknown): KpiItem[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("Добавьте хотя бы один пункт KPI");
  if (raw.length > 20) throw new Error("Не больше 20 пунктов KPI");
  const seen = new Set<string>();
  const items = raw.map((value): KpiItem => {
    const r = record(value);
    const id = typeof r.id === "string" ? r.id : "";
    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (!/^[a-z0-9_]{1,40}$/.test(id)) throw new Error("Некорректный пункт KPI. Обновите страницу");
    if (!label || label.length > 80) throw new Error("Название пункта — от 1 до 80 символов");
    if (seen.has(id)) throw new Error(`Пункт «${label}» повторяется`);
    seen.add(id);
    if (r.type === "done") return { id, type: "done", label, amount: money(r.amount, label, "сумму") };
    if (r.type === "each") return { id, type: "each", label, price: money(r.price, label, "цену") };
    if (r.type === "plan") {
      // «alcohol» — имя показателя до перехода на долю (миграция 418).
      if (r.metric !== "alcohol_share" && r.metric !== "alcohol") throw new Error(`Пункт «${label}»: выберите показатель плана`);
      return { id, type: "plan", label, amount: money(r.amount, label, "сумму"), metric: "alcohol_share" };
    }
    if (r.type === "all") {
      const requires = Array.isArray(r.requires) ? [...new Set(r.requires.filter((x): x is string => typeof x === "string"))] : [];
      return { id, type: "all", label, amount: money(r.amount, label, "сумму"), requires };
    }
    throw new Error(`Пункт «${label}»: выберите тип`);
  });
  const done = new Set(items.filter((i) => i.type === "done").map((i) => i.id));
  for (const item of items) {
    if (item.type === "all" && (item.requires.length < 2 || item.requires.some((id) => !done.has(id))))
      throw new Error(`Бонус «${item.label}» должен зависеть от двух и более пунктов «Сделано»`);
  }
  if (items.filter((i) => i.type === "plan").length > 1) throw new Error("В условиях может быть только один план");
  return items;
}

const pct = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;

/** Итог месяца по ответам чек-листа. План засчитывается только при факте ≥ плана. */
export function kpiResult(items: KpiItem[], answers: KpiAnswers, plan: KpiPlanFact): { lines: KpiLine[]; total: number } {
  const counted = new Set<string>();
  const lines: KpiLine[] = items.map((item) => {
    const base = { id: item.id, label: item.label, type: item.type };
    if (item.type === "done") {
      const ok = answers[item.id] === true;
      if (ok) counted.add(item.id);
      return { ...base, amount: ok ? item.amount : 0, counted: ok, note: null };
    }
    if (item.type === "each") {
      const raw = answers[item.id] ?? 0;
      const n = typeof raw === "number" ? raw : Number.NaN;
      if (!Number.isInteger(n) || n < 0 || n > KPI_MAX_COUNT)
        throw new Error(`«${item.label}»: количество от 0 до ${KPI_MAX_COUNT}`);
      return { ...base, amount: round(n * item.price), counted: n > 0, note: n > 0 ? `×${n}` : null };
    }
    if (item.type === "plan") {
      // Пока месяц идёт, план ещё могут задать — пункт ждёт конца месяца.
      if (plan.pending === "month") return { ...base, amount: 0, counted: false, note: KPI_WAITING_MONTH };
      if (plan.target === null || plan.target <= 0) return { ...base, amount: 0, counted: false, note: "План не был задан" };
      if (plan.actual === null) return { ...base, amount: 0, counted: false, note: KPI_WAITING_REPORT };
      const ok = plan.actual >= plan.target;
      return { ...base, amount: ok ? item.amount : 0, counted: ok, note: `${pct(plan.actual)} при плане ${pct(plan.target)}` };
    }
    return { ...base, amount: 0, counted: false, note: null };
  });
  // «Бонус за все» — после остальных: зависит от уже засчитанных пунктов.
  for (const [i, item] of items.entries()) {
    if (item.type !== "all") continue;
    const ok = item.requires.every((id) => counted.has(id));
    lines[i] = { ...lines[i], amount: ok ? item.amount : 0, counted: ok };
  }
  return { lines, total: round(lines.reduce((s, l) => s + l.amount, 0)) };
}

export const KPI_WAITING_REPORT = "Ждём отчёт Quick Resto";
export const KPI_WAITING_MONTH = "Посчитаем после конца месяца";

/**
 * Итог сохранили, пока отчёта продаж за месяц не было: пункт плана не
 * засчитан «пока», и итог нужно досчитать, когда отчёт придёт.
 */
export function kpiNeedsRecount(lines: Pick<KpiLine, "type" | "counted" | "note">[]): boolean {
  return lines.some((l) => l.type === "plan" && !l.counted && (l.note === KPI_WAITING_REPORT || l.note === KPI_WAITING_MONTH));
}

/**
 * Итог сохранили по другим условиям KPI (их поменяли в идущем месяце) —
 * его нужно пересохранить: пункты и суммы могли измениться.
 */
export function kpiReviewOutdated(review: { termsId: string; items: unknown }, current: { id: string; items: unknown }): boolean {
  return review.termsId !== current.id || JSON.stringify(review.items) !== JSON.stringify(current.items);
}

/** Основание премии: «KPI за ноябрь 2026: Инвентаризация до 20-го, Сезонные позиции ×2». */
export function kpiReason(month: string, lines: KpiLine[]): string {
  const parts = lines.filter((l) => l.counted).map((l) => (l.type === "each" && l.note ? `${l.label} ${l.note}` : l.label));
  return `KPI за ${transferMonthLabel(month)}: ${parts.length ? parts.join(", ") : "без выполненных пунктов"}`;
}

/** Сводка условий для свёрнутой строки: сколько пунктов, максимум без «за каждую». */
export function kpiSummary(items: KpiItem[]): { count: number; max: number; each: { label: string; price: number }[] } {
  return {
    count: items.length,
    max: round(items.reduce((s, i) => s + (i.type === "each" ? 0 : i.amount), 0)),
    each: items.flatMap((i) => (i.type === "each" ? [{ label: i.label, price: i.price }] : [])),
  };
}

const lastDay = (month: string) => {
  const d = new Date(`${month}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
};

/**
 * Кому подводить KPI за месяц: должность на последний день M с условиями KPI,
 * действующими в M. Разовые — никогда; уволенные — если есть начисления за M.
 */
export function kpiPeople(
  employees: PayEmployee[],
  assignments: PayAssignment[],
  models: PayModel[],
  terms: { id: string; role_id: string; valid_from: string }[],
  month: string,
  accruedIds: Set<string>,
): KpiPerson[] {
  if (month < KPI_START) return [];
  const end = lastDay(month);
  return employees.flatMap((e) => {
    if (e.casual || (!e.active && !accruedIds.has(e.id))) return [];
    const at = employeeAtDate(e, assignments, models, end);
    if (!at.role_id) return [];
    const version = terms
      .filter((t) => t.role_id === at.role_id && t.valid_from <= month)
      .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
    if (!version) return [];
    const start = assignments
      .filter((a) => a.employee_id === e.id && a.valid_from <= end)
      .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0]?.valid_from;
    return [{ employeeId: e.id, termsId: version.id, roleId: at.role_id, since: start && start > month ? start : null }];
  });
}
