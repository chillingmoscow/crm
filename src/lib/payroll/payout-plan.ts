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
  // Клинер: первая — с 20-го M, вторая — с 5-го M+1 (ближайшая смена с этого дня), Павел 27.11.
  cleaner: { method: "cash", first: [20, 1], second: [5, 16], step: 5000, reserve: 0 },
  // Переводом — ровно половина месяца: без округления и запаса, счёт выбирают при каждой оплате.
  transfer: { method: "transfer", first: [25, 1], second: [10, 16], step: 0, reserve: 0, bank_account_id: null },
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

export type PayoutNo = 1 | 2;

/**
 * Период плана, в который попадает `today`. Один план на выплату за месяц
 * (все наличные графики, у каждого свой день — Павел, 27.11): первая выплата
 * за M — 17-е M … 1-е M+1, вторая — 2-е … 16-е M+1. Любой день попадает в
 * один из периодов, поэтому план можно сформировать заранее.
 */
export function payoutPeriod(today: string): { month: string; payoutNo: PayoutNo; from: string; to: string } {
  const day = Number(today.slice(8, 10));
  const current = `${today.slice(0, 7)}-01`;
  if (day >= 17) return { month: current, payoutNo: 1, from: `${today.slice(0, 7)}-17`, to: shiftMonth(current, 1) };
  const month = shiftMonth(current, -1);
  if (day === 1) return { month, payoutNo: 1, from: `${month.slice(0, 7)}-17`, to: current };
  return { month, payoutNo: 2, from: `${today.slice(0, 7)}-02`, to: `${today.slice(0, 7)}-16` };
}

const dayOf = (month: string, day: number) => `${month.slice(0, 7)}-${String(day).padStart(2, "0")}`;

/** Дни выплаты графика внутри периода: первая — [день M, день M+1], вторая — дни M+1. */
export function scheduleWindow(config: PayoutSchedule, payoutNo: PayoutNo, month: string): { from: string; to: string } {
  const next = shiftMonth(month, 1);
  return payoutNo === 1
    ? { from: dayOf(month, config.first[0]), to: dayOf(next, config.first[1]) }
    : { from: dayOf(next, config.second[0]), to: dayOf(next, config.second[1]) };
}

export type PayoutFlag = "few_shifts" | "no_shift" | "unmoved_balance";
/**
 * Как посчитана сумма: половина прогноза месяца (первая, основной график),
 * заработано за 1–15 (первая, клинер), остаток месяца (вторая выплата).
 * В планах этапа 1 поля нет — это «half».
 */
export type PayoutMode = "half" | "first_earned" | "rest";
export type PayoutBreakdown = {
  mode?: PayoutMode;
  /** Заработано за 1–15 число M — для первой выплаты клинера. */
  earnedFirstHalf?: number;
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
  /** half − P − официальная часть, до округления. */
  target: number;
  /** Ожидаемая официальная часть месяца: её выплатит бухгалтерия (или агентство). */
  official: number;
  /** Официальную часть платит агентство («Платит агентство»). */
  officialAgency?: boolean;
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
  /** Дни выплаты графика (scheduleWindow). */
  window: { from: string; to: string };
  /** Опубликованные смены, уже привязанные к сотруднику. */
  shifts: { employee_id: string; business_date: string }[];
  /** Первая (по умолчанию) или вторая выплата за месяц. */
  payoutNo?: PayoutNo;
}): PlannedRow[] {
  const { data, month, today, window } = input;
  const payoutNo = input.payoutNo ?? 1;
  const mode: PayoutMode = payoutNo === 2 ? "rest" : input.schedule === "cleaner" ? "first_earned" : "half";
  // Переводом сумма — ровно половина месяца, сохранённые шаг и запас не действуют.
  const config =
    input.schedule === "transfer"
      ? { ...input.schedules.transfer, step: 0, reserve: 0 }
      : input.schedules[input.schedule];
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
    if (config.method === "cash" && mode === "half") {
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

    const official = row.officialExpected?.amount ?? 0;
    // Вторая выплата — остаток месяца: без запаса и прогноза.
    const reserve = mode === "rest" ? 0 : config.reserve;
    // Премия KPI за M известна только 1-го M+1 и платится второй выплатой:
    // в первую (половину или заработанное за 1–15) она не входит, даже если её уже записали.
    const kpiSources = new Set(
      data.adjustments
        .filter((a) => a.employee_id === id && a.origin === "kpi" && !a.deleted_at)
        .map((a) => `payroll-entry:${a.id}`),
    );
    const kpiAccrued = mode !== "rest" && kpiSources.size
      ? round(
          data.accruals
            .filter((a) => a.employee_id === id && a.business_date >= month && a.business_date < until)
            .flatMap((a) => a.components)
            .filter((c) => c.source && kpiSources.has(c.source))
            .reduce((s, c) => s + (c.amount ?? 0), 0),
        )
      : 0;
    // Первая выплата клинера — заработанное за 1–15 число (с удержаниями, без
    // штрафов на подтверждении).
    const midMonth = dayOf(month, 16);
    const earnedFirstHalf = mode === "first_earned"
      ? round(
          data.accruals
            .filter((a) => a.employee_id === id && a.business_date >= month && a.business_date < midMonth)
            .reduce((s, a) => s + Number(a.salary), 0) - kpiAccrued -
          data.adjustments
            .filter((a) => a.employee_id === id && !a.approved && !a.deleted_at && a.amount < 0 &&
              (a.medium ?? "money") === "money" && a.business_date >= month && a.business_date < midMonth)
            .reduce((s, a) => s - Number(a.amount), 0),
        )
      : 0;
    const half = mode === "half" ? round((carried + earned - kpiAccrued + forecast - reserve) / 2) : 0;
    // Официальная часть идёт в счёт первой половины месяца (Павел, 25.11): её
    // платим и при увольнении, поэтому подстраховываемся на первой выплате.
    const ceiling = round(carried + earned - paid - reserve - official);
    const target =
      mode === "half" ? round(half - paid - official)
      : mode === "first_earned" ? round(carried + earnedFirstHalf - paid)
      : ceiling;
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
        mode, ...(mode === "first_earned" ? { earnedFirstHalf } : {}),
        carried, earned, pendingFines, forecast, forecastShifts, averageShift,
        reserve, paid, half, target, official, ceiling, flags,
        ...(row.officialExpected?.agency ? { officialAgency: true } : {}),
      },
    };
  });
}

/**
 * Сколько выдать по утверждённой строке сейчас. Сумма плана не пересчитывается
 * (ручные правки остаются): её режет только свежий потолок, если после
 * утверждения появились выплаты или штрафы. `capped` — срезано потолком: такая
 * строка после выдачи закрывается, остатка по ней нет.
 */
export function recheckDue(
  row: { amount: number; issued: number },
  ceilingNow: number,
  step: number,
): { due: number; capped: boolean } {
  const left = round(row.amount - row.issued);
  const cap = Math.max(0, round(ceilingNow));
  if (left <= cap) return { due: Math.max(0, left), capped: false };
  return { due: Math.max(0, floorStep(cap, step)), capped: true };
}

/**
 * До какой суммы выдавать строку плана сейчас. Расчётную — до свежего потолка
 * (заработано минус выплаченное, запас и официальная часть). Сумму, которую
 * поставили руками, — целиком: это решение человека, например аванс; её
 * ограничивает только заработанное (запас и официальная часть не вычитаются),
 * как и проверка при сохранении строки (Павел, 26.11).
 */
export function issueCap(b: { ceiling: number; reserve: number; official: number }, manual: boolean): number {
  return manual ? round(b.ceiling + b.reserve + b.official) : b.ceiling;
}

export type PayoutRowState = "issued" | "partial" | "none" | "invoice" | "waiting" | "missed" | "no_day";

/** Что показать в строке плана: выдано, ждёт дня, день пропущен, ждёт счёта. */
export function payoutRowState(
  row: { amount: number; issued: number; pay_date: string | null },
  today: string,
  method: "cash" | "transfer",
): PayoutRowState {
  if (row.issued > 0 && row.issued >= row.amount) return "issued";
  if (row.amount <= 0) return "none";
  if (method === "transfer") return row.issued > 0 ? "partial" : "invoice";
  if (!row.pay_date) return "no_day";
  if (row.pay_date < today) return "missed";
  return row.issued > 0 ? "partial" : "waiting";
}

export type PayDayChoiceGroup = { label: string | undefined; days: { date: string; past: boolean }[] };

/**
 * Дни для выбора дня выплаты: сначала те, где у сотрудника смена в графике
 * (выдают на смене), потом остальные. Прошедшие дни не предлагаем; уже
 * выбранный прошедший день остаётся в списке недоступным, чтобы было видно,
 * что стоит сейчас. Без доступа к графику — один список, без деления.
 */
export function payDayChoices(
  days: string[],
  shiftDays: string[],
  today: string,
  current: string | null,
  shiftsKnown: boolean,
): PayDayChoiceGroup[] {
  const ahead = days.filter((d) => d >= today).map((date) => ({ date, past: false }));
  const groups: PayDayChoiceGroup[] = [];
  if (shiftsKnown) {
    const shifts = new Set(shiftDays);
    const withShift = ahead.filter((d) => shifts.has(d.date));
    const without = ahead.filter((d) => !shifts.has(d.date));
    if (withShift.length) groups.push({ label: "Есть смена", days: withShift });
    if (without.length) groups.push({ label: "Без смены", days: without });
  } else if (ahead.length) {
    groups.push({ label: undefined, days: ahead });
  }
  if (current && current < today) groups.push({ label: "Прошли", days: [{ date: current, past: true }] });
  return groups;
}
