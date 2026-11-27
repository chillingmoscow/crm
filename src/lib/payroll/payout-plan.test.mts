import { test } from "node:test";
import assert from "node:assert/strict";
import {
  issueCap,
  payDayChoices,
  DEFAULT_PAYOUT_SCHEDULES,
  payoutPeriod,
  scheduleWindow,
  floorStep,
  payoutRowState,
  planFirstPayout,
  recheckDue,
} from "./payout-plan.ts";
import type { Accrual, Adjustment, Allocation, PayEmployee, Payment } from "./types.ts";

const MONTH = "2026-11-01";
const TODAY = "2026-11-25";

function employee(id: string, extra: Partial<PayEmployee> = {}): PayEmployee {
  return {
    id, account_id: "a", venue_id: "v", quickresto_id: null, name: id, local_user_id: null,
    role_name: "Бармен", model_id: null, hired_on: null, experience_offset_months: 0,
    active: true, opening_balance: 0, opening_confirmed: true, ...extra,
  };
}
let seq = 0;
function accrual(employee_id: string, business_date: string, salary: number, kind = "shift", monthly = 0): Accrual {
  return {
    id: `acc-${++seq}`, employee_id, business_date, period_id: "p", rule_version_id: null,
    components: monthly ? [{ kind: "monthly", label: "Оклад", amount: monthly, basis: "", source: "" }] : [],
    salary, tips: 0, status: "approved", issues: [], calculation_snapshot: { kind }, updated_at: "",
  };
}
function payment(id: string, amount: number): Payment {
  return { id, transaction_id: null, cashbox_id: null, kind: "salary", amount, state: "posted",
    note: "", occurred_at: "2026-11-10T10:00:00Z", created_at: "2026-11-10T10:00:00Z" };
}
function allocation(employee_id: string, payment_id: string, amount: number): Allocation {
  return { employee_id, payment_id, accrual_id: null, month: MONTH, amount, settled_amount: amount };
}

type Fx = {
  employees: PayEmployee[]; accruals: Accrual[]; adjustments?: Adjustment[];
  payments?: Payment[]; allocations?: Allocation[];
  shifts?: { employee_id: string; business_date: string }[];
  schedule?: "main" | "transfer" | "cleaner";
};
function input(fx: Fx) {
  return {
    data: {
      employees: fx.employees, accruals: fx.accruals, adjustments: fx.adjustments ?? [],
      payments: fx.payments ?? [], allocations: fx.allocations ?? [], transfers: [],
      officialExpected: [], settings: { starts_on: "2026-09-01" } as never,
    },
    schedules: DEFAULT_PAYOUT_SCHEDULES,
    schedule: fx.schedule ?? "main",
    month: MONTH,
    today: TODAY,
    window: { from: "2026-11-25", to: "2026-12-01" },
    shifts: fx.shifts ?? [],
  };
}
/** 10 смен по avgShift в ноябре + оклад, чтобы заработанное в M было earnedInMonth. */
function fixture(o: { earnedInMonth: number; avgShift: number; shiftsAhead: number }) {
  const accruals = Array.from({ length: 10 }, (_, i) =>
    accrual("filipp", `2026-11-${String(i + 1).padStart(2, "0")}`, o.avgShift));
  const rest = o.earnedInMonth - o.avgShift * 10;
  if (rest) accruals.push(accrual("filipp", "2026-11-15", rest, "monthly", rest));
  const shifts = ["2026-11-27", "2026-11-29", "2026-11-30"].slice(0, o.shiftsAhead)
    .map((business_date) => ({ employee_id: "filipp", business_date }));
  return input({ employees: [employee("filipp")], accruals, shifts });
}
function salaryFixture(o: { monthly: number; schedule: "transfer" }) {
  return input({
    employees: [employee("tanya", { payout_schedule: o.schedule })],
    accruals: [accrual("tanya", "2026-11-01", o.monthly, "monthly", o.monthly)],
    schedule: o.schedule,
  });
}

test("floorStep rounds down, never up", () => {
  assert.equal(floorStep(46292, 5000), 45000);
  assert.equal(floorStep(23850, 500), 23500);
  assert.equal(floorStep(-1, 5000), -5000);
});

test("payoutPeriod: каждый день — в периоде первой или второй выплаты", () => {
  assert.deepEqual(payoutPeriod("2026-11-25"), { month: "2026-11-01", payoutNo: 1, from: "2026-11-17", to: "2026-12-01" });
  assert.deepEqual(payoutPeriod("2026-11-17"), { month: "2026-11-01", payoutNo: 1, from: "2026-11-17", to: "2026-12-01" });
  assert.deepEqual(payoutPeriod("2026-12-01"), { month: "2026-11-01", payoutNo: 1, from: "2026-11-17", to: "2026-12-01" });
  assert.deepEqual(payoutPeriod("2026-12-02"), { month: "2026-11-01", payoutNo: 2, from: "2026-12-02", to: "2026-12-16" });
  assert.deepEqual(payoutPeriod("2026-12-16"), { month: "2026-11-01", payoutNo: 2, from: "2026-12-02", to: "2026-12-16" });
  assert.deepEqual(payoutPeriod("2027-01-05"), { month: "2026-12-01", payoutNo: 2, from: "2027-01-02", to: "2027-01-16" });
});

test("scheduleWindow: дни графика внутри периода — основной 25–1 и 10–16, клинер 20-е и 5-е", () => {
  const S = DEFAULT_PAYOUT_SCHEDULES;
  assert.deepEqual(scheduleWindow(S.main, 1, MONTH), { from: "2026-11-25", to: "2026-12-01" });
  assert.deepEqual(scheduleWindow(S.main, 2, MONTH), { from: "2026-12-10", to: "2026-12-16" });
  assert.deepEqual(scheduleWindow(S.cleaner, 1, MONTH), { from: "2026-11-20", to: "2026-12-01" });
  assert.deepEqual(scheduleWindow(S.cleaner, 2, MONTH), { from: "2026-12-05", to: "2026-12-16" });
});

test("Филипп: 83 258 earned, 2 shifts ahead at avg 7 163 → 45 000", () => {
  const [row] = planFirstPayout(fixture({ earnedInMonth: 83258, avgShift: 7163, shiftsAhead: 2 }));
  assert.equal(row.amount, 45000);
  assert.equal(row.breakdown.forecast, 14326);
  assert.equal(row.breakdown.forecastShifts, 2);
  assert.equal(row.breakdown.averageShift, 7163);
  assert.equal(row.breakdown.reserve, 5000);
  assert.equal(row.breakdown.target, 46292);
  assert.equal(row.pay_date, "2026-11-27");
});

test("Татьяна (transfer, оклад 47 700, без смен) → ровно половина 23 850, без округления и даты", () => {
  const [row] = planFirstPayout(salaryFixture({ monthly: 47700, schedule: "transfer" }));
  assert.equal(row.amount, 23850);
  assert.equal(row.breakdown.reserve, 0);
  assert.equal(row.pay_date, null);
  assert.equal(row.breakdown.forecast, 0);
  assert.deepEqual(row.breakdown.flags, []);
});

test("fewer than 3 shifts → no forecast, flag few_shifts", () => {
  const plan = planFirstPayout(input({
    employees: [employee("new")],
    accruals: [accrual("new", "2026-11-20", 6000), accrual("new", "2026-11-21", 6000)],
    shifts: [{ employee_id: "new", business_date: "2026-11-26" }],
  }));
  assert.equal(plan[0].breakdown.forecast, 0);
  assert.equal(plan[0].breakdown.averageShift, null);
  assert.ok(plan[0].breakdown.flags.includes("few_shifts"));
  // (12 000 − 5 000) / 2 = 3 500 → 0 при шаге 5 000
  assert.equal(plan[0].amount, 0);
});

test("ceiling after manual payment: paid 10 000 of 20 000 earned → 5 000", () => {
  // Средняя смена 10 000 (8 в октябре + 2 в ноябре), E=20 000, впереди 6 смен → F=60 000, R=5 000, P=10 000:
  // цель = (20 000 + 60 000 − 5 000)/2 − 10 000 = 27 500; потолок = 20 000 − 10 000 − 5 000 = 5 000.
  const accruals = [
    ...Array.from({ length: 8 }, (_, i) => accrual("e", `2026-10-${String(i + 1).padStart(2, "0")}`, 10000)),
    accrual("e", "2026-11-05", 10000), accrual("e", "2026-11-06", 10000),
  ];
  const shifts = Array.from({ length: 10 }, (_, i) =>
    ({ employee_id: "e", business_date: `2026-11-${String(i + 21).padStart(2, "0")}` }));
  const [row] = planFirstPayout(input({
    employees: [employee("e")], accruals, shifts,
    payments: [payment("p1", 10000)], allocations: [allocation("e", "p1", 10000)],
  }));
  assert.equal(row.breakdown.forecastShifts, 6); // 25–30 ноября
  assert.equal(row.breakdown.forecast, 60000);
  assert.equal(row.breakdown.paid, 10000);
  assert.equal(row.breakdown.target, 27500);
  assert.equal(row.breakdown.ceiling, 5000);
  assert.equal(row.amount, 5000);
});

test("pending fine is subtracted from earned", () => {
  const fine: Adjustment = {
    id: "f", employee_id: "tanya", business_date: "2026-11-10", kind: "fine", amount: -3000,
    reason: "Опоздание", source_ref: null, approved: false, medium: "money",
  };
  const bonus: Adjustment = { ...fine, id: "b", medium: "bonus" };
  const approved: Adjustment = { ...fine, id: "ok", approved: true };
  const base = salaryFixture({ monthly: 47700, schedule: "transfer" });
  const [row] = planFirstPayout({ ...base, data: { ...base.data, adjustments: [fine, bonus, approved] } });
  assert.equal(row.breakdown.pendingFines, 3000);
  assert.equal(row.breakdown.earned, 44700);
  assert.equal(row.amount, 22350); // 44 700 / 2, переводом без округления
});

test("official part counts toward the first half of the month", () => {
  // Начислено 100 000, прогноза нет, запас 5 000: половина 47 500; официальная часть 30 000
  // идёт в счёт первой половины — наличными 17 500 → 15 000.
  const base = input({ employees: [employee("o")], accruals: [accrual("o", "2026-11-10", 100000, "monthly", 100000)] });
  const official = (gross: number) => [{ employee_id: "o", employment_id: "x", month: MONTH, kind: "full" as const, gross, days_paid: null, days_in_month: 30 }];
  const [row] = planFirstPayout({ ...base, data: { ...base.data, officialExpected: official(30000) } });
  assert.equal(row.breakdown.official, 30000);
  assert.equal(row.breakdown.target, 17500);
  assert.equal(row.amount, 15000);
  // Официальная часть больше половины месяца (Павлов: 74 667 при половине ~65 000) — наличными 0.
  const [big] = planFirstPayout({ ...base, data: { ...base.data, officialExpected: official(60000) } });
  assert.equal(big.amount, 0);
});

test("only employees of the schedule, active, not casual", () => {
  const plan = planFirstPayout(input({
    employees: [
      employee("main1"),
      employee("cleaner", { payout_schedule: "cleaner" }),
      employee("casual", { casual: true }),
      employee("gone", { active: false }),
      employee("tanya", { payout_schedule: "transfer" }),
    ],
    accruals: ["main1", "cleaner", "casual", "gone", "tanya"].map((id) => accrual(id, "2026-11-10", 20000)),
  }));
  assert.deepEqual(plan.map((r) => r.employee_id), ["main1"]);
});

test("no shift in window → pay_date null and flag no_shift (cash schedule)", () => {
  const [row] = planFirstPayout(input({
    employees: [employee("e")], accruals: [accrual("e", "2026-11-10", 40000)],
    shifts: [{ employee_id: "e", business_date: "2026-11-20" }],
  }));
  assert.equal(row.pay_date, null);
  assert.ok(row.breakdown.flags.includes("no_shift"));
});

test("pay_date = first shift in window not before today", () => {
  const base = input({
    employees: [employee("e")], accruals: [accrual("e", "2026-11-10", 40000)],
    shifts: ["2026-11-24", "2026-11-28", "2026-12-01", "2026-12-03"]
      .map((business_date) => ({ employee_id: "e", business_date })),
  });
  assert.equal(planFirstPayout(base)[0].pay_date, "2026-11-28");
  assert.equal(planFirstPayout({ ...base, today: "2026-11-29" })[0].pay_date, "2026-12-01");
});

test("unpaid balance of previous month that was not moved → flag unmoved_balance", () => {
  const [row] = planFirstPayout(input({
    employees: [employee("e")],
    accruals: [accrual("e", "2026-10-10", 10000), accrual("e", "2026-11-10", 40000)],
    shifts: [{ employee_id: "e", business_date: "2026-11-26" }],
  }));
  assert.ok(row.breakdown.flags.includes("unmoved_balance"));
  assert.equal(row.breakdown.carried, 0); // непереносённый остаток в сумму не входит
});

test("recheckDue: only the ceiling cuts, the planned amount is not recomputed", () => {
  // План 30 000, свежий потолок 40 000 (свежий пересчёт формулы дал бы 25 000) — выдаём 30 000.
  assert.deepEqual(recheckDue({ amount: 30000, issued: 0 }, 40000, 5000), { due: 30000, capped: false });
  // Ручная правка не по шагу (47 500) сохраняется.
  assert.deepEqual(recheckDue({ amount: 47500, issued: 0 }, 60000, 5000), { due: 47500, capped: false });
  // Ручная выплата после утверждения: потолок 12 300 — выдаём 10 000, строка закрывается.
  assert.deepEqual(recheckDue({ amount: 20000, issued: 0 }, 12300, 5000), { due: 10000, capped: true });
  // Уже выдана часть: сравнивается остаток строки.
  assert.deepEqual(recheckDue({ amount: 45000, issued: 20000 }, 25000, 5000), { due: 25000, capped: false });
  assert.deepEqual(recheckDue({ amount: 45000, issued: 20000 }, -100, 5000), { due: 0, capped: true });
});

test("payoutRowState: missed day is visible", () => {
  const row = { amount: 30000, issued: 0, pay_date: "2026-11-26" };
  assert.equal(payoutRowState(row, "2026-11-26", "cash"), "waiting");
  assert.equal(payoutRowState(row, "2026-11-27", "cash"), "missed");
  assert.equal(payoutRowState({ ...row, pay_date: null }, "2026-11-27", "cash"), "no_day");
  assert.equal(payoutRowState({ ...row, issued: 10000 }, "2026-11-27", "cash"), "missed");
  assert.equal(payoutRowState({ ...row, issued: 10000, pay_date: "2026-11-28" }, "2026-11-27", "cash"), "partial");
  assert.equal(payoutRowState({ ...row, issued: 30000 }, "2026-11-27", "cash"), "issued");
  assert.equal(payoutRowState({ ...row, amount: 0 }, "2026-11-27", "cash"), "none");
  assert.equal(payoutRowState({ ...row, pay_date: null }, "2026-11-27", "transfer"), "invoice");
});

test("transfer schedule ignores saved step and reserve", () => {
  const base = salaryFixture({ monthly: 47700, schedule: "transfer" });
  const [row] = planFirstPayout({
    ...base,
    schedules: { ...DEFAULT_PAYOUT_SCHEDULES, transfer: { ...DEFAULT_PAYOUT_SCHEDULES.transfer, step: 500, reserve: 1000 } },
  });
  assert.equal(row.amount, 23850);
  assert.equal(row.breakdown.reserve, 0);
});

test("payDayChoices: сначала дни со сменой, прошедшие дни не предлагаем", () => {
  const days = ["2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"];
  const r = payDayChoices(days, ["2026-11-25", "2026-11-27", "2026-11-29"], "2026-11-26", null, true);
  assert.deepEqual(r, [
    { label: "Есть смена", days: [{ date: "2026-11-27", past: false }, { date: "2026-11-29", past: false }] },
    { label: "Без смены", days: [{ date: "2026-11-26", past: false }, { date: "2026-11-28", past: false }] },
  ]);
});

test("payDayChoices: выбранный прошедший день остаётся в списке, но недоступен", () => {
  const r = payDayChoices(["2026-11-25", "2026-11-26"], [], "2026-11-26", "2026-11-25", true);
  assert.deepEqual(r, [
    { label: "Без смены", days: [{ date: "2026-11-26", past: false }] },
    { label: "Прошли", days: [{ date: "2026-11-25", past: true }] },
  ]);
});

test("payDayChoices: график не виден — один список без деления по сменам", () => {
  const r = payDayChoices(["2026-11-26", "2026-11-27"], [], "2026-11-26", null, false);
  assert.deepEqual(r, [{ label: undefined, days: [{ date: "2026-11-26", past: false }, { date: "2026-11-27", past: false }] }]);
});

test("issueCap: расчётную строку режет потолок, ручную (аванс) — только заработанное", () => {
  // Наталия, 26.11: перенос −28 698, начислено 50 411, запас 5 000, официальная часть 27 500.
  const b = { ceiling: -10787.14, reserve: 5000, official: 27500 };
  assert.equal(issueCap(b, false), -10787.14);
  assert.equal(issueCap(b, true), 21712.86);
  assert.deepEqual(recheckDue({ amount: 20000, issued: 0 }, issueCap(b, true), 5000), { due: 20000, capped: false });
  assert.deepEqual(recheckDue({ amount: 20000, issued: 0 }, issueCap(b, false), 5000), { due: 0, capped: true });
});


test("вторая выплата: остаток месяца без прогноза и запаса, официальная часть вычитается", () => {
  // Начислено 125 000, выплачено 75 000, ожидается агентская/официальная часть 4 350.
  const fx = input({
    employees: [employee("h", { payout_schedule: "cleaner" })],
    accruals: [accrual("h", "2026-11-10", 75000), accrual("h", "2026-11-26", 50000)],
    payments: [payment("p1", 75000)], allocations: [allocation("h", "p1", 75000)],
    shifts: [{ employee_id: "h", business_date: "2026-12-05" }, { employee_id: "h", business_date: "2026-12-06" }],
    schedule: "cleaner",
  });
  fx.data.officialExpected = [{ employee_id: "h", month: MONTH, gross: 4350, kind: "full", days_paid: null, days_in_month: null }] as never;
  const [row] = planFirstPayout({ ...fx, payoutNo: 2, today: "2026-12-03", window: { from: "2026-12-05", to: "2026-12-16" } });
  assert.equal(row.breakdown.mode, "rest");
  assert.equal(row.breakdown.forecast, 0);
  assert.equal(row.breakdown.reserve, 0);
  assert.equal(row.breakdown.target, 45650);
  assert.equal(row.amount, 45000);
  assert.equal(row.pay_date, "2026-12-05");
});

test("вторая выплата клинера: нет смены 5-го — ближайшая следующая", () => {
  const fx = input({
    employees: [employee("h", { payout_schedule: "cleaner" })],
    accruals: [accrual("h", "2026-11-10", 20000)],
    shifts: [{ employee_id: "h", business_date: "2026-12-04" }, { employee_id: "h", business_date: "2026-12-07" }],
    schedule: "cleaner",
  });
  const [row] = planFirstPayout({ ...fx, payoutNo: 2, today: "2026-12-02", window: { from: "2026-12-05", to: "2026-12-16" } });
  assert.equal(row.pay_date, "2026-12-07");
});

test("первая выплата клинера: заработано за 1–15 минус выплаченное", () => {
  const fx = input({
    employees: [employee("h", { payout_schedule: "cleaner" })],
    accruals: [accrual("h", "2026-11-05", 40000), accrual("h", "2026-11-15", 35000), accrual("h", "2026-11-18", 9000)],
    shifts: [{ employee_id: "h", business_date: "2026-11-20" }],
    schedule: "cleaner",
  });
  const [row] = planFirstPayout({ ...fx, today: "2026-11-19", window: { from: "2026-11-20", to: "2026-12-01" } });
  assert.equal(row.breakdown.mode, "first_earned");
  assert.equal(row.breakdown.earnedFirstHalf, 75000);
  assert.equal(row.amount, 75000);
  assert.equal(row.pay_date, "2026-11-20");
});

test("первая выплата основного графика — по-прежнему половина", () => {
  const [row] = planFirstPayout(fixture({ earnedInMonth: 83258, avgShift: 7163, shiftsAhead: 2 }));
  assert.equal(row.breakdown.mode, "half");
});

/** Премия KPI за ноябрь: начисление 1-го с компонентом из записи журнала. */
function withKpi(fx: ReturnType<typeof fixture>, amount: number) {
  const kpi: Accrual = {
    ...accrual("filipp", "2026-11-01", amount, "adjustment"),
    components: [{ kind: "allowance", label: "KPI", amount, basis: "Ручная запись", source: "payroll-entry:k1" }],
  };
  const adjustment = { id: "k1", employee_id: "filipp", business_date: "2026-11-01", kind: "allowance", amount,
    reason: "KPI за ноябрь 2026", source_ref: "payroll-entry:k1", approved: true, origin: "kpi", medium: "money" } as Adjustment;
  return { ...fx, data: { ...fx.data, accruals: [...fx.data.accruals, kpi], adjustments: [...fx.data.adjustments, adjustment] } };
}

test("первая выплата: премия KPI не входит в половину", () => {
  const [row] = planFirstPayout(withKpi(fixture({ earnedInMonth: 83258, avgShift: 7163, shiftsAhead: 2 }), 27000));
  assert.equal(row.amount, 45000);
});

test("вторая выплата: премия KPI входит в остаток месяца", () => {
  const [row] = planFirstPayout({ ...withKpi(fixture({ earnedInMonth: 83258, avgShift: 7163, shiftsAhead: 0 }), 27000), payoutNo: 2 });
  assert.equal(row.amount, 110000);
});
