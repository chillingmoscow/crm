import { paymentSettlement } from "./payment-journal.ts";
import type { Accrual, Allocation, Payment } from "./types";

/** Одна строка внутри раскрытой статьи расчётного листа. */
export type PaySheetItem = {
  key: string;
  /** Начисление, из которого взята строка: по нему открывается расчёт дня. */
  accrualId: string;
  /** Вид составляющей (`base`, `bonus`, `deduction`…). */
  kind: string;
  /** Сумму ввёл человек (премия, штраф, надбавка): строка ведёт к записи. */
  manual: boolean;
  date: string;
  title: string;
  note: string;
  amount: number | null;
};

/** Статья начисления: «Выходы», «Процент от продаж» и так далее. */
export type PaySheetGroup = {
  id: string;
  label: string;
  /** null — хотя бы одна сумма внутри неизвестна, итог показывать нельзя. */
  amount: number | null;
  /** Одинаковая сумма всех строк, если она действительно одна; иначе null. */
  uniform: number | null;
  items: PaySheetItem[];
};

export type PaySheet = {
  groups: PaySheetGroup[];
  /** Сумма положительных начислений; null, если часть данных не получена. */
  earned: number | null;
  deductions: PaySheetItem[];
  /** Отрицательное число или 0. */
  deducted: number;
  shifts: number;
};

export type PaySheetPayment = {
  id: string;
  date: string;
  kind: Payment["kind"];
  posted: boolean;
  /** Сколько долга закрыла выплата за этот месяц (с налогом, если он был). */
  amount: number;
  /** Официальная (бухгалтерская) выплата за месяц. */
  official: boolean;
  /** Официальная запись «Получено через агентство»: без налога и операции. */
  agency: boolean;
  /** Удержанный налог; 0 — без налога или выплата делится с другими. */
  tax: number;
};

const GROUPS: { id: string; label: string; kinds: string[] }[] = [
  { id: "monthly", label: "Оклад", kinds: ["monthly"] },
  { id: "base", label: "Выходы", kinds: ["base"] },
  { id: "percent", label: "Процент от продаж", kinds: ["percent"] },
  { id: "extra", label: "Допродажи", kinds: ["extra"] },
  { id: "experience", label: "Надбавка за стаж", kinds: ["experience"] },
  { id: "allowance", label: "Надбавка за месяц", kinds: ["allowance"] },
  { id: "bonus", label: "Премии", kinds: ["bonus", "cleaner"] },
  { id: "knowledge", label: "Знания", kinds: ["knowledge"] },
  { id: "food", label: "Питание", kinds: ["food"] },
  { id: "correction", label: "Корректировки", kinds: ["correction"] },
];
/** Статьи, где сумму ввёл человек: в строке показываем его основание. */
const MANUAL = new Set(["allowance", "bonus", "deduction", "correction", "inventory", "warning"]);

const cents = (n: number) => Math.round(n * 100);

const isShift = (a: Accrual) =>
  !["monthly", "adjustment"].includes(String(a.calculation_snapshot.kind));

export const monthKey = (month: string) => month.slice(0, 7);

/** Сдвиг первого числа месяца на delta месяцев: «2026-10-01», +1 → «2026-11-01». */
export function shiftMonth(month: string, delta: number) {
  const date = new Date(`${monthKey(month)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 10);
}

/**
 * Раскладывает начисления одного сотрудника за месяц по статьям.
 * Чаевые сюда не входят: они учитываются отдельно от зарплаты.
 */
export function buildPaySheet(
  accruals: Accrual[],
  month: string,
  roleOf: (accrual: Accrual) => string,
): PaySheet {
  const ym = monthKey(month);
  const current = accruals
    .filter((a) => a.business_date.startsWith(ym))
    .sort((a, b) => b.business_date.localeCompare(a.business_date));
  const buckets = new Map<string, PaySheetItem[]>();
  const deductions: PaySheetItem[] = [];
  for (const accrual of current)
    accrual.components.forEach((c, index) => {
      if (c.kind === "tips") return;
      const manual = MANUAL.has(c.kind);
      const item: PaySheetItem = {
        key: `${accrual.id}.${index}`,
        accrualId: accrual.id,
        kind: c.kind,
        manual,
        date: accrual.business_date,
        title: c.kind === "base" ? roleOf(accrual) : manual ? c.label : c.basis || c.label,
        note: c.kind === "base" ? c.basis : "",
        amount: c.amount === null ? null : Number(c.amount),
      };
      if (item.amount !== null && item.amount < 0) {
        deductions.push({ ...item, title: c.label });
        return;
      }
      const group = GROUPS.find((g) => g.kinds.includes(c.kind));
      const id = group?.id ?? `other:${c.label}`;
      buckets.set(id, [...(buckets.get(id) ?? []), item]);
    });
  const groups: PaySheetGroup[] = [];
  const push = (id: string, label: string) => {
    const items = buckets.get(id);
    if (!items?.length) return;
    const unknown = items.some((i) => i.amount === null);
    const total = items.reduce((sum, i) => sum + cents(i.amount ?? 0), 0);
    // Нулевая статья без пропусков — например стаж до даты начала начисления.
    if (!unknown && total === 0) return;
    const first = items[0].amount;
    groups.push({
      id,
      label,
      amount: unknown ? null : total / 100,
      uniform:
        first !== null && items.every((i) => i.amount === first) ? first : null,
      items,
    });
  };
  for (const g of GROUPS) push(g.id, g.label);
  for (const id of buckets.keys())
    if (id.startsWith("other:")) push(id, id.slice(6));
  return {
    groups,
    earned: groups.some((g) => g.amount === null)
      ? null
      : groups.reduce((sum, g) => sum + cents(g.amount ?? 0), 0) / 100,
    deductions,
    deducted: deductions.reduce((sum, d) => sum + cents(d.amount ?? 0), 0) / 100,
    shifts: current.filter(isShift).length,
  };
}

/** Выплаты, которые закрывают долг сотрудника за выбранный месяц. */
export function paySheetPayments(
  payments: Payment[],
  allocations: Allocation[],
  employeeId: string,
  month: string,
): PaySheetPayment[] {
  const ym = monthKey(month);
  const byPayment = new Map<string, number>();
  for (const a of allocations) {
    if (a.employee_id !== employeeId || monthKey(a.month) !== ym) continue;
    byPayment.set(
      a.payment_id,
      (byPayment.get(a.payment_id) ?? 0) + cents(Number(a.settled_amount ?? a.amount)),
    );
  }
  return payments
    .filter((p) => byPayment.has(p.id))
    .map((p) => {
      // Налог выплаты целиком — только когда она вся про этого сотрудника и месяц.
      const own = allocations.filter((a) => a.payment_id === p.id);
      const whole = own.every((a) => a.employee_id === employeeId && monthKey(a.month) === ym);
      return {
        id: p.id,
        date: p.occurred_at,
        kind: p.kind,
        posted: p.state === "posted",
        amount: (byPayment.get(p.id) ?? 0) / 100,
        official: !!p.official_month,
        agency: !!p.official_month && p.agency === true,
        tax: whole ? (paymentSettlement(own, Number(p.amount)).taxAmount ?? 0) : 0,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Начислено по месяцам для полоски истории: `count` месяцев, последний — `until`.
 * Месяцы раньше `min` не показываются.
 */
export function payMonthHistory(
  accruals: Accrual[],
  until: string,
  min: string,
  count = 6,
) {
  const months: { month: string; earned: number }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const month = shiftMonth(until, -i);
    if (monthKey(month) < monthKey(min)) continue;
    const ym = monthKey(month);
    months.push({
      month,
      earned:
        accruals
          .filter((a) => a.business_date.startsWith(ym))
          .reduce((sum, a) => sum + cents(Number(a.salary)), 0) / 100,
    });
  }
  return months;
}
