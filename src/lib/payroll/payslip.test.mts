import test from "node:test";
import assert from "node:assert/strict";
import { buildPayslip, payslipFileName } from "./payslip.ts";
import type { Accrual, Component, PayEmployee, PayrollData } from "./types.ts";

const c = (kind: string, amount: number | null, label = kind, basis = ""): Component => ({
  kind,
  label,
  amount,
  basis,
  source: "",
});
const accrual = (id: string, date: string, components: Component[], snapshot: Record<string, unknown> = { kind: "shift" }): Accrual => ({
  id,
  employee_id: "e1",
  business_date: date,
  period_id: "p",
  rule_version_id: null,
  components,
  salary: components.filter((x) => x.kind !== "tips").reduce((s, x) => s + (x.amount ?? 0), 0),
  tips: components.filter((x) => x.kind === "tips").reduce((s, x) => s + (x.amount ?? 0), 0),
  status: "approved",
  issues: [],
  calculation_snapshot: snapshot,
  updated_at: "",
});
const employee = {
  id: "e1",
  account_id: "a",
  venue_id: "v",
  quickresto_id: null,
  name: "Иван Петров",
  local_user_id: null,
  role_name: "Бармен",
  model_id: null,
  hired_on: null,
  experience_offset_months: 0,
  active: true,
  opening_balance: 0,
  opening_confirmed: true,
} as unknown as PayEmployee;

const data = (accruals: Accrual[], extra: Partial<PayrollData> = {}) =>
  ({
    accruals,
    adjustments: [],
    payments: [],
    allocations: [],
    transfers: [],
    legacyPayments: [],
    settings: { starts_on: "2026-09-01" },
    ...extra,
  }) as unknown as PayrollData;

const october = [
  accrual("1", "2026-10-28", [
    c("base", 2500, "Выход", "1 сотрудников · среда"),
    c("percent", 3750, "Процент от продаж", "49 998 ₽ × 7.5% · бар"),
    c("extra", 4040, "Дополнительные продажи", "4 040 ₽ / 1 сотрудников"),
    c("experience", 0, "Стаж"),
    c("tips", 1438, "Чаевые"),
    c("deduction", -3600, "Опоздание на 42 мин."),
  ]),
  accrual("2", "2026-10-02", [], {
    kind: "shift",
    legacy: { "%": "3", Процент: "1893", "Bar / Касса": "63091", "Shisha / Касса": "102141", "Дополнительные продажи": "2980", "Сотрудники на смене / Одной должности": "2" },
  }),
  accrual("3", "2026-10-30", [c("bonus", 9500, "Работа без барбека")], { kind: "adjustment" }),
  accrual("4", "2026-11-01", [c("base", 2500)]),
];
october[1].components = [c("base", 1500), c("percent", 1893), c("extra", 2980), c("tips", 410)];
october[1].salary = 6373;
october[1].tips = 410;

test("смены по порядку, итог смены без премий и удержаний", () => {
  const p = buildPayslip(data(october), employee, "2026-10-01", () => "Бармен");
  assert.deepEqual(p.shifts.map((s) => s.date), ["2026-10-02", "2026-10-28"]);
  assert.equal(p.shifts[1].total, 10290);
  assert.equal(p.shifts[1].tips, 1438);
  assert.equal(p.shiftTotal, 16663);
});

test("премии и удержания отдельно, всё вместе равно начисленному", () => {
  const p = buildPayslip(data(october), employee, "2026-10-01", () => "Бармен");
  assert.deepEqual(p.additions, [{ date: "2026-10-30", title: "Работа без барбека", amount: 9500 }]);
  assert.deepEqual(p.deductions, [{ date: "2026-10-28", title: "Опоздание на 42 мин.", amount: -3600 }]);
  assert.equal((p.shiftTotal ?? 0) + p.additionsTotal + p.deductionsTotal, p.earned);
  assert.equal(p.earned, 22563);
});

const detail = (x: { sales: unknown; rate: unknown; salesSource: unknown; extraPool: unknown; sharedWith: unknown }) => ({
  sales: x.sales, rate: x.rate, salesSource: x.salesSource, extraPool: x.extraPool, sharedWith: x.sharedWith,
});

test("из чего смена: выручка, ставка, касса — из расчёта и из сохранённой строки Glide", () => {
  const p = buildPayslip(data(october), employee, "2026-10-01", () => "Бармен");
  assert.deepEqual(detail(p.shifts[1]), { sales: 49998, rate: 7.5, salesSource: "бар", extraPool: null, sharedWith: 1 });
  assert.deepEqual(detail(p.shifts[0]), { sales: 63091, rate: 3, salesSource: "бар", extraPool: 5960, sharedWith: 2 });
});

test("смена на двоих: общая сумма допродаж и число человек", () => {
  const shift = accrual("9", "2026-10-30", [
    c("base", 1500, "Выход", "2 сотрудников · пятница"),
    c("percent", 2492, "Процент от продаж", "83 061 ₽ × 3% · бар"),
    c("extra", 3320, "Дополнительные продажи", "6 640 ₽ / 2 сотрудников"),
  ]);
  const p = buildPayslip(data([shift]), employee, "2026-10-01", () => "Бармен");
  assert.deepEqual(detail(p.shifts[0]), { sales: 83061, rate: 3, salesSource: "бар", extraPool: 6640, sharedWith: 2 });
});

test("неизвестная сумма не превращается в ноль", () => {
  const p = buildPayslip(data([accrual("1", "2026-10-05", [c("base", 2500), c("extra", null)])]), employee, "2026-10-01", () => "Бармен");
  assert.equal(p.shifts[0].total, null);
  assert.equal(p.shiftTotal, null);
});

test("непроверенный начальный остаток скрывает остаток к выплате", () => {
  const p = buildPayslip(data(october), { ...employee, opening_confirmed: false }, "2026-10-01", () => "Бармен");
  assert.equal(p.remainingKnown, false);
});

test("имя файла", () => {
  assert.equal(payslipFileName({ employee: "Иван Петров", month: "2026-10-01" }), "Расчётный лист — Иван Петров — октябрь 2026.pdf");
});
