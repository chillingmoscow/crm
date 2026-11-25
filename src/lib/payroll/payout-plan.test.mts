import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PAYOUT_SCHEDULES,
  firstPayoutWindow,
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

test("firstPayoutWindow: 25.11–01.12 belongs to November", () => {
  assert.deepEqual(firstPayoutWindow("2026-11-25"), { month: "2026-11-01", from: "2026-11-25", to: "2026-12-01" });
  assert.deepEqual(firstPayoutWindow("2026-12-01"), { month: "2026-11-01", from: "2026-11-25", to: "2026-12-01" });
  assert.deepEqual(firstPayoutWindow("2026-12-31"), { month: "2026-12-01", from: "2026-12-25", to: "2027-01-01" });
  assert.equal(firstPayoutWindow("2026-11-24"), null);
  assert.equal(firstPayoutWindow("2026-12-02"), null);
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

test("official part expected this month lowers the ceiling", () => {
  const base = salaryFixture({ monthly: 47700, schedule: "transfer" });
  const [row] = planFirstPayout({
    ...base,
    data: {
      ...base.data,
      officialExpected: [{ employee_id: "tanya", employment_id: "o", month: MONTH, kind: "full", gross: 40000, days_paid: null, days_in_month: 30 }],
    },
  });
  assert.equal(row.breakdown.official, 40000);
  assert.equal(row.breakdown.ceiling, 7700);
  assert.equal(row.amount, 7700);
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
