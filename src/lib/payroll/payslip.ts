// Monthly pay statement for one employee: the data behind the downloadable PDF.
// Pure: the same numbers as the «Оплата» tab, arranged so an employee can follow them.
import { statementRows } from "./calculate.ts";
import { paySheetPayments } from "./pay-sheet.ts";
import type { OfficialExpectedView } from "./official.ts";
import type { Accrual, PayEmployee, PayrollData } from "./types.ts";

export type PayslipShift = {
  date: string;
  role: string;
  base: number | null;
  percent: number | null;
  extra: number | null;
  /** Стаж, знания, питание — прочие начисления за выход. */
  other: number | null;
  total: number | null;
  tips: number;
  /** Из чего получился процент: выручка, ставка и чья касса. */
  sales: number | null;
  rate: number | null;
  salesSource: string | null;
  /** Общие допродажи смены до деления; null, если делить не пришлось или сумма неизвестна. */
  extraPool: number | null;
  /** Сколько человек одной должности делили выход и допродажи; 1 — работал один. */
  sharedWith: number;
};

export type PayslipEntry = { date: string; title: string; amount: number | null };

export type Payslip = {
  month: string;
  employee: string;
  role: string;
  shifts: PayslipShift[];
  shiftTotal: number | null;
  /** Премии, надбавки, оклад, положительные корректировки. */
  additions: PayslipEntry[];
  additionsTotal: number;
  /** Штрафы, недостачи и прочие удержания; суммы отрицательные. */
  deductions: PayslipEntry[];
  deductionsTotal: number;
  earned: number;
  opening: number;
  transferredOut: number;
  paid: number;
  /** Ожидаемая, ещё не проведённая официальная часть; уже вычтена из remaining. */
  officialExpected: OfficialExpectedView | null;
  remaining: number;
  /** Остаток нельзя назвать, пока прежние выплаты месяца не сверены. */
  remainingKnown: boolean;
  payments: { date: string; amount: number }[];
  tips: number;
  tipPaid: number;
  /** Замечания к расчёту: незавершённые данные. */
  issues: string[];
};

const PER_SHIFT = new Set(["base", "percent", "extra", "experience", "knowledge", "food"]);
const OTHER = new Set(["experience", "knowledge", "food"]);
const cents = (n: number) => Math.round(n * 100);
const sum = (values: (number | null)[]) =>
  values.some((v) => v === null) ? null : values.reduce<number>((s, v) => s + cents(v ?? 0), 0) / 100;

const isShift = (a: Accrual) => !["monthly", "adjustment"].includes(String(a.calculation_snapshot.kind));

const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
type ShiftDetail = Pick<PayslipShift, "sales" | "rate" | "salesSource" | "extraPool" | "sharedWith">;
const NONE: ShiftDetail = { sales: null, rate: null, salesSource: null, extraPool: null, sharedWith: 1 };

/** Shifts carried over from Glide kept only totals: rebuild the detail from the saved row. */
function legacyDetail(legacy: Record<string, unknown>): ShiftDetail {
  const out = { ...NONE };
  const pct = num(legacy["%"]),
    percent = num(legacy["Процент"]);
  if (pct && percent) {
    const sources: [string, unknown][] = [
      ["бар", legacy["Bar / Касса"]],
      ["кальяны", legacy["Shisha / Касса"]],
      ["оборот", legacy["Оборот"]],
    ];
    const hit = sources.find(([, v]) => {
      const base = num(v);
      return base !== null && Math.abs(Math.round((base * pct) / 100) - percent) <= 1;
    });
    if (hit) Object.assign(out, { sales: num(hit[1]), rate: pct, salesSource: hit[0] });
  }
  const same = num(legacy["Сотрудники на смене / Одной должности"]);
  // Glide kept only the rounded share, not the pool: the statement says «÷ N» without inventing a total.
  if (same && same > 1) out.sharedWith = same;
  return out;
}

const amountIn = (text: string) => num(text.replace(/[^\d,.]/g, ""));

function shiftDetail(a: Accrual): ShiftDetail {
  const legacy = a.calculation_snapshot.legacy;
  if (legacy && typeof legacy === "object") return legacyDetail(legacy as Record<string, unknown>);
  const out = { ...NONE };
  const people = (basis: string) => Number(/(\d+) сотрудник/.exec(basis)?.[1] ?? 1);
  for (const c of a.components) {
    if (!c.basis) continue;
    if (c.kind === "base") out.sharedWith = Math.max(out.sharedWith, people(c.basis));
    if (c.kind === "percent") {
      // «49 998 ₽ × 7.5% · бар»
      const m = /^(.+?)₽\s*×\s*([\d.,]+)%\s*·\s*(.+)$/.exec(c.basis);
      if (m) Object.assign(out, { sales: amountIn(m[1]), rate: num(m[2]), salesSource: m[3].trim() });
    }
    if (c.kind === "extra") {
      // «6 640 ₽ / 2 сотрудников»
      const m = /^(.+?)₽\s*\/\s*(\d+)/.exec(c.basis);
      if (m && Number(m[2]) > 1) {
        out.extraPool = amountIn(m[1]);
        out.sharedWith = Math.max(out.sharedWith, Number(m[2]));
      }
    }
  }
  return out;
}

export function buildPayslip(
  data: PayrollData,
  employee: PayEmployee,
  month: string,
  roleOf: (a: Accrual) => string,
): Payslip {
  const ym = month.slice(0, 7);
  const current = data.accruals
    .filter((a) => a.employee_id === employee.id && a.business_date.startsWith(ym))
    .sort((a, b) => a.business_date.localeCompare(b.business_date) || a.id.localeCompare(b.id));

  const shifts: PayslipShift[] = [];
  const additions: PayslipEntry[] = [];
  const deductions: PayslipEntry[] = [];
  for (const a of current) {
    const pick = (kinds: (k: string) => boolean) =>
      a.components.filter((c) => kinds(c.kind) && (c.amount === null || c.amount >= 0)).map((c) => c.amount);
    if (isShift(a)) {
      const parts = {
        base: sum(pick((k) => k === "base")),
        percent: sum(pick((k) => k === "percent")),
        extra: sum(pick((k) => k === "extra")),
        other: sum(pick((k) => OTHER.has(k))),
      };
      shifts.push({
        date: a.business_date,
        role: roleOf(a),
        ...parts,
        total: sum(pick((k) => PER_SHIFT.has(k))),
        tips: Number(a.tips),
        ...shiftDetail(a),
      });
    }
    for (const c of a.components) {
      if (c.kind === "tips") continue;
      const amount = c.amount === null ? null : Number(c.amount);
      if (amount !== null && amount < 0) deductions.push({ date: a.business_date, title: c.label, amount });
      else if (!(isShift(a) && PER_SHIFT.has(c.kind)) && amount !== 0)
        additions.push({ date: a.business_date, title: c.kind === "monthly" ? "Оклад за месяц" : c.label, amount });
    }
  }

  const row = statementRows(
    [employee],
    data.accruals,
    data.adjustments,
    data.payments,
    data.allocations,
    month,
    data.transfers,
    data.settings?.starts_on,
    data.officialExpected ?? [],
  )[0];
  const legacyPending = data.legacyPayments.some(
    (p) => p.employee_id === employee.id && p.month.slice(0, 7) === ym && p.state === "review",
  );
  const payments = paySheetPayments(data.payments, data.allocations, employee.id, month)
    .filter((p) => p.kind !== "tips" && p.posted)
    .map((p) => ({ date: p.date, amount: p.amount }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    month,
    employee: employee.name,
    role: employee.role_name,
    shifts,
    shiftTotal: sum(shifts.map((s) => s.total)),
    additions,
    additionsTotal: sum(additions.map((e) => e.amount ?? 0)) ?? 0,
    deductions,
    deductionsTotal: sum(deductions.map((e) => e.amount ?? 0)) ?? 0,
    earned: row?.earned ?? 0,
    opening: row?.opening ?? 0,
    transferredOut: row?.transferredOut ?? 0,
    paid: row?.paid ?? 0,
    officialExpected: row?.officialExpected ?? null,
    remaining: row?.remaining ?? 0,
    remainingKnown: !legacyPending,
    payments,
    tips: row?.tips ?? 0,
    tipPaid: row?.tipPaid ?? 0,
    issues: [...new Set(current.flatMap((a) => a.issues))],
  };
}

/** «Расчётный лист — Эрик Усманов — октябрь 2026.pdf» */
export function payslipFileName(p: Pick<Payslip, "employee" | "month">) {
  const month = new Date(`${p.month.slice(0, 7)}-01T12:00:00Z`)
    .toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })
    .replace(" г.", "");
  return `Расчётный лист — ${p.employee} — ${month}.pdf`.replace(/[\\/:*?"<>|]/g, "");
}
