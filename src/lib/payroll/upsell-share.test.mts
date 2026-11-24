import test from "node:test";
import assert from "node:assert/strict";

import { departmentShares, extrasEligible, staleUpsellPayrollDays } from "./upsell-share.ts";
import { computeAccrual, shiftDutyDepartment } from "./calculate.ts";
import type { PayEmployee, PayModel, PayRule } from "./types.ts";

test("допродажи по умолчанию — только у бармена и мастера", () => {
  assert.equal(extrasEligible(undefined, "Бармен"), true);
  assert.equal(extrasEligible(null, "Мастер"), true);
  assert.equal(extrasEligible({ extras_enabled: false }, "Мастер"), false);
  assert.equal(extrasEligible(undefined, "Старший бармен"), false);
  assert.equal(extrasEligible({ extras_enabled: true }, "Менеджер"), true);
});

const BAR = "dep-bar";
const switchDates = new Map([[BAR, "2026-12-01"]]);

test("день до перехода — legacy, день перехода — доля", () => {
  const present = [{ id: "a", departmentId: BAR, eligible: true }];
  const days = new Map([[BAR, 1200]]);
  const before = departmentShares({ date: "2026-11-30", present, switchDates, days });
  assert.equal(before.get("a"), "legacy");
  const on = departmentShares({ date: "2026-12-01", present, switchDates, days });
  assert.deepEqual(on.get("a"), { amount: 1200, divisor: 1 });
});

test("подразделение без правил и сотрудник без подразделения — legacy", () => {
  const shares = departmentShares({
    date: "2026-12-05",
    present: [
      { id: "a", departmentId: "dep-other", eligible: true },
      { id: "b", departmentId: null, eligible: true },
    ],
    switchDates,
    days: new Map(),
  });
  assert.equal(shares.get("a"), "legacy");
  assert.equal(shares.get("b"), "legacy");
});

test("двое барменов и старший без допродаж: делитель 2, у старшего null", () => {
  const shares = departmentShares({
    date: "2026-12-02",
    present: [
      { id: "b1", departmentId: BAR, eligible: true },
      { id: "b2", departmentId: BAR, eligible: true },
      { id: "senior", departmentId: BAR, eligible: false },
    ],
    switchDates,
    days: new Map([[BAR, 1801]]),
  });
  assert.deepEqual(shares.get("b1"), { amount: 1801, divisor: 2 });
  assert.deepEqual(shares.get("b2"), { amount: 1801, divisor: 2 });
  assert.equal(shares.get("senior"), null);
});

test("на смене только сотрудник без допродаж — фонд никому, делителя нет", () => {
  const shares = departmentShares({
    date: "2026-12-02",
    present: [{ id: "senior", departmentId: BAR, eligible: false }],
    switchDates,
    days: new Map([[BAR, 1801]]),
  });
  assert.equal(shares.get("senior"), null);
  assert.equal([...shares.values()].some((v) => v !== null), false);
});

test("дня нет — amount null у всех eligible", () => {
  const present = [
    { id: "b1", departmentId: BAR, eligible: true },
    { id: "b2", departmentId: BAR, eligible: true },
  ];
  for (const days of [new Map<string, number | null>(), new Map([[BAR, null]])]) {
    const shares = departmentShares({ date: "2026-12-02", present, switchDates, days });
    assert.deepEqual(shares.get("b1"), { amount: null, divisor: 2 });
    assert.deepEqual(shares.get("b2"), { amount: null, divisor: 2 });
  }
});

const employee: PayEmployee = {
  id: "b1",
  account_id: "acc",
  venue_id: "ven",
  quickresto_id: 1,
  name: "Бармен",
  local_user_id: null,
  role_name: "Бармен",
  model_id: "m1",
  hired_on: null,
  experience_offset_months: 0,
  active: true,
  opening_balance: 0,
  opening_confirmed: false,
};
const model: PayModel = {
  id: "m1",
  name: "Бармен",
  role_name: "Бармен",
  basis: "none",
  tips: false,
  experience: false,
  knowledge_amount: 0,
  food_amount: 0,
  cleaner_bonus: 0,
  quickresto_role_id: null,
  monthly_amount: 0,
  archived: false,
};
const week = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [String(d), { base: 2000, percent: null }]));
const rule: PayRule = {
  id: "r1",
  model_id: "m1",
  employee_id: null,
  valid_from: "2026-09-01",
  rates: { "1": week, "2": week, "3": week },
  experience_steps: {},
  created_at: "2026-09-01T00:00:00Z",
  monthly_amount: null,
  tenure_requires_exam: false,
  config: {},
};
const accrual = (extraShare?: { amount: number | null; divisor: number; department: string } | null) =>
  computeAccrual({
    employee,
    model,
    rule,
    date: "2026-12-02",
    roleCount: 3,
    tipRecipients: 0,
    metrics: {},
    extra: 5000,
    attendanceIssues: [],
    adjustments: [],
    cleanerPresent: true,
    extraShare,
  });

test("computeAccrual: доля подразделения вместо отчёта по должности", () => {
  const result = accrual({ amount: 1801, divisor: 2, department: "Бар" });
  const extras = result.components.filter((c) => c.kind === "extra");
  assert.equal(extras.length, 1);
  assert.equal(extras[0].amount, 901);
  assert.equal(extras[0].label, "Дополнительные продажи");
  assert.equal(extras[0].basis, `${(1801).toLocaleString("ru-RU")} ₽ / 2 сотрудников · Бар`);
  assert.equal(extras[0].source, "Sheerly · чеки дня");
  assert.equal(result.salary, 2000 + 901);
  assert.deepEqual(result.issues, []);
});

test("computeAccrual: не посчитанный день подразделения — проблема, сумма пустая", () => {
  const result = accrual({ amount: null, divisor: 2, department: "Бар" });
  const extra = result.components.find((c) => c.kind === "extra");
  assert.equal(extra?.amount, null);
  assert.ok(result.issues.includes("Не посчитаны допродажи подразделения"));
  assert.ok(!result.issues.includes("Не получен отчёт дополнительных продаж"));
});

test("computeAccrual: подразделение перешло, сотруднику не положено — без компонента и без старой ветки", () => {
  const result = accrual(null);
  assert.equal(result.components.some((c) => c.kind === "extra"), false);
  assert.equal(result.salary, 2000);
});

test("computeAccrual без extraShare — прежняя ветка по должности", () => {
  const result = accrual(undefined);
  const extra = result.components.find((c) => c.kind === "extra");
  assert.equal(extra?.amount, Math.round(5000 / 3));
  assert.equal(extra?.source, "Quick Resto · отчёт продаж");
  assert.equal(extra?.basis, `${(5000).toLocaleString("ru-RU")} ₽ / 3 сотрудников`);
});

test("staleUpsellPayrollDays: зарплата старее готовой прибавки — в очередь", () => {
  const upsell = [
    { business_date: "2026-12-01", state: "ready", computed_at: "2026-12-02T10:00:00Z" },
    { business_date: "2026-12-02", state: "pending", computed_at: "2026-12-03T10:00:00Z" },
    { business_date: "2026-12-03", state: "ready", computed_at: "2026-12-04T10:00:00Z" },
    { business_date: "2026-12-04", state: "ready", computed_at: "2026-12-05T10:00:00Z" },
    { business_date: "2026-12-05", state: "ready", computed_at: "2026-12-05T10:00:00Z" },
    { business_date: "2026-12-06", state: "ready", computed_at: "2026-12-06T10:00:00Z" },
    { business_date: "2026-12-07", state: "ready", computed_at: "2026-12-07T10:00:00Z" },
    // два подразделения в один день — дата одна
    { business_date: "2026-12-01", state: "ready", computed_at: "2026-12-02T11:00:00Z" },
  ];
  const payroll = [
    { business_date: "2026-12-01", state: "complete", synced_at: "2026-12-02T09:00:00Z" }, // старее → да
    { business_date: "2026-12-02", state: "complete", synced_at: "2026-12-01T09:00:00Z" }, // не ready → нет
    { business_date: "2026-12-03", state: "loading", synced_at: "2026-12-01T09:00:00Z" }, // считается → нет
    { business_date: "2026-12-04", state: "pending", synced_at: null }, // в очереди → нет
    { business_date: "2026-12-05", state: "complete", synced_at: "2026-12-05T11:00:00Z" }, // новее → нет
    { business_date: "2026-12-06", state: "error", synced_at: null }, // без времени → да
    // 2026-12-07 — строки зарплаты нет → да
  ];
  assert.deepEqual(staleUpsellPayrollDays(upsell, payroll), ["2026-12-01", "2026-12-06", "2026-12-07"]);
});

test("staleUpsellPayrollDays: готовая строка без времени расчёта не ставит день", () => {
  assert.deepEqual(
    staleUpsellPayrollDays(
      [{ business_date: "2026-12-01", state: "ready", computed_at: null }],
      [{ business_date: "2026-12-01", state: "complete", synced_at: "2026-12-01T00:00:00Z" }],
    ),
    [],
  );
});

test("shiftDutyDepartment: подразделение должности смены, без должности — по схеме оплаты", () => {
  const roles = new Map<string, string | null>([["role-bar", BAR], ["role-mgr", "dep-mgr"]]);
  const models = [{ id: "m-bar", role_id: "role-bar" }, { id: "m-mgr", role_id: "role-mgr" }];
  // Ставка может идти по основной должности, но фонд — подразделения смены.
  assert.equal(
    shiftDutyDepartment({ role_id: "role-bar", department_id: null, payroll_model_id: null }, models, "m-mgr", roles),
    BAR,
  );
  assert.equal(
    shiftDutyDepartment({ role_id: "role-bar", department_id: null, payroll_model_id: "m-mgr" }, models, "m-mgr", roles),
    "dep-mgr",
  );
  assert.equal(
    shiftDutyDepartment({ role_id: null, department_id: null, payroll_model_id: null }, models, "m-bar", roles),
    BAR,
  );
  assert.equal(
    shiftDutyDepartment({ role_id: "role-x", department_id: "dep-shift", payroll_model_id: null }, models, null, roles),
    "dep-shift",
  );
});
