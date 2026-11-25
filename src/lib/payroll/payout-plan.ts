import { round, statementRows } from "./calculate.ts";
import type { PayrollData } from "./types.ts";

// План первой выплаты за месяц: сколько выдать каждому сотруднику графика.
// Чистые функции, без обращений к базе — их гоняет node --test.

export type PayoutScheduleCode = "main" | "cleaner" | "transfer";
export type PayoutSchedule = {
  /** Как выдаём: наличными через менеджеров или переводом со счёта. */
  method: "cash" | "transfer";
  /** Окно первой выплаты: [день M, день M+1] — 25-е M … 1-е M+1. */
  first: [number, number];
  /** Окно второй выплаты: дни M+1. */
  second: [number, number];
  /** Шаг округления вниз. */
  step: number;
  /** Запас на инвентаризацию и штрафы. */
  reserve: number;
  /** Счёт выплаты переводом; для наличных — общий счёт из настроек. */
  bank_account_id?: string | null;
};

export const DEFAULT_PAYOUT_SCHEDULES: Record<PayoutScheduleCode, PayoutSchedule> = {
  main: { method: "cash", first: [25, 1], second: [10, 16], step: 5000, reserve: 5000 },
  cleaner: { method: "cash", first: [18, 22], second: [3, 7], step: 5000, reserve: 0 },
  transfer: { method: "transfer", first: [25, 1], second: [10, 16], step: 500, reserve: 0, bank_account_id: null },
};

export const PAYOUT_SCHEDULE_LABELS: Record<PayoutScheduleCode, string> = {
  main: "Основной",
  cleaner: "Клинер",
  transfer: "Переводом",
};

/** Округление вниз до шага: 46 292 → 45 000 при шаге 5 000. */
export function floorStep(value: number, step: number): number {
  if (step <= 0) return round(value);
  return Math.floor(round(value) / step) * step;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const shiftMonth = (month: string, by: number) => {
  const d = new Date(`${month}T12:00:00Z`);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + by);
  return iso(d);
};

/**
 * Окно первой выплаты (графики «Основной» и «Переводом»), в которое попадает
 * `today`: с 25-го M по 1-е M+1. Вне окна — null.
 */
export function firstPayoutWindow(
  today: string,
): { month: string; from: string; to: string } | null {
  const day = Number(today.slice(8, 10));
  const current = `${today.slice(0, 7)}-01`;
  const month = day >= 25 ? current : day === 1 ? shiftMonth(current, -1) : null;
  if (!month) return null;
  return { month, from: `${month.slice(0, 7)}-25`, to: shiftMonth(month, 1) };
}

export type PayoutFlag = "few_shifts" | "no_shift" | "unmoved_balance";
export type PayoutBreakdown = {
  /** Остаток, уже перенесённый в M (C). */
  carried: number;
  /** Заработано в M за вычетом ожидающих штрафов (E). */
  earned: number;
  pendingFines: number;
  /** Прогноз до конца месяца (F). */
  forecast: number;
  forecastShifts: number;
  averageShift: number | null;
  reserve: number;
  /** Уже выплачено за M (P). */
  paid: number;
  /** Половина месяца: (C + E + F − R) / 2. */
  half: number;
  /** half − P, до округления. */
  target: number;
  /** Ожидаемая официальная часть месяца: её выплатит бухгалтерия. */
  official: number;
  /** C + E − P − R − официальная часть, до округления. */
  ceiling: number;
  flags: PayoutFlag[];
};
export type PlannedRow = {
  employee_id: string;
  pay_date: string | null;
  amount: number;
  breakdown: PayoutBreakdown;
};

type PlanData = Pick<
  PayrollData,
  "employees" | "accruals" | "adjustments" | "payments" | "allocations" | "transfers" | "officialExpected" | "settings"
>;

const SHIFT_HISTORY = 10;
const MIN_SHIFTS_FOR_FORECAST = 3;

export function planFirstPayout(input: {
  data: PlanData;
  schedules: Record<PayoutScheduleCode, PayoutSchedule>;
  schedule: PayoutScheduleCode;
  month: string;
  today: string;
  window: { from: string; to: string };
  /** Опубликованные смены, уже привязанные к сотруднику. */
  shifts: { employee_id: string; business_date: string }[];
}): PlannedRow[] {
  const { data, month, today, window } = input;
  const config = input.schedules[input.schedule];
  const until = shiftMonth(month, 1);
  const startsOn = data.settings?.starts_on ?? "2026-09-01";
  const employees = data.employees.filter(
    (e) => e.active && !e.casual && (e.payout_schedule ?? "main") === input.schedule,
  );
  const rows = statementRows(
    employees, data.accruals, data.adjustments, data.payments, data.allocations,
    month, data.transfers, startsOn, data.officialExpected ?? [],
  );
  const previousMonth = shiftMonth(month, -1);
  const previous =
    previousMonth >= startsOn
      ? new Map(
          statementRows(
            employees, data.accruals, data.adjustments, data.payments, data.allocations,
            previousMonth, data.transfers, startsOn, data.officialExpected ?? [],
          ).map((r) => [r.employee.id, r]),
        )
      : new Map();

  return rows.map((row) => {
    const id = row.employee.id;
    const flags: PayoutFlag[] = [];
    const carried = round(row.opening - row.transferredOut);
    const paid = row.paid;
    const pendingFines = round(
      data.adjustments
        .filter(
          (a) =>
            a.employee_id === id &&
            !a.approved &&
            !a.deleted_at &&
            a.amount < 0 &&
            (a.medium ?? "money") === "money" &&
            a.business_date >= month &&
            a.business_date < until,
        )
        .reduce((s, a) => s - Number(a.amount), 0),
    );
    const earned = round(row.earned - pendingFines);

    let forecast = 0, forecastShifts = 0, averageShift: number | null = null;
    if (config.method === "cash") {
      const own = data.accruals.filter((a) => a.employee_id === id);
      const history = own
        .filter(
          (a) =>
            a.business_date < today &&
            !["monthly", "adjustment"].includes(String(a.calculation_snapshot.kind)),
        )
        .sort((a, b) => b.business_date.localeCompare(a.business_date))
        .slice(0, SHIFT_HISTORY)
        .map((a) =>
          Number(a.salary) -
          a.components.filter((c) => c.kind === "monthly").reduce((s, c) => s + (c.amount ?? 0), 0),
        );
      const accrued = new Set(own.map((a) => a.business_date));
      forecastShifts = new Set(
        input.shifts
          .filter(
            (s) =>
              s.employee_id === id &&
              s.business_date >= today &&
              s.business_date < until &&
              !accrued.has(s.business_date),
          )
          .map((s) => s.business_date),
      ).size;
      if (history.length >= MIN_SHIFTS_FOR_FORECAST) {
        averageShift = round(history.reduce((s, v) => s + v, 0) / history.length);
        forecast = round(averageShift * forecastShifts);
      } else {
        flags.push("few_shifts");
      }
    }

    const reserve = config.reserve;
    const official = row.officialExpected?.amount ?? 0;
    const half = round((carried + earned + forecast - reserve) / 2);
    const target = round(half - paid);
    const ceiling = round(carried + earned - paid - reserve - official);
    const amount = Math.max(0, floorStep(Math.max(0, Math.min(target, ceiling)), config.step));

    let pay_date: string | null = null;
    if (config.method === "cash") {
      const from = today > window.from ? today : window.from;
      pay_date =
        input.shifts
          .filter((s) => s.employee_id === id && s.business_date >= from && s.business_date <= window.to)
          .map((s) => s.business_date)
          .sort()[0] ?? null;
      if (!pay_date) flags.push("no_shift");
    }

    const before = previous.get(id);
    if (before && before.remaining !== 0 && before.transferredOut === 0) flags.push("unmoved_balance");

    return {
      employee_id: id,
      pay_date,
      amount,
      breakdown: {
        carried, earned, pendingFines, forecast, forecastShifts, averageShift,
        reserve, paid, half, target, official, ceiling, flags,
      },
    };
  });
}
