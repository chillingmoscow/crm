import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPaySheet,
  pendingEarnedHint,
  payMonthHistory,
  paySheetPayments,
  shiftMonth,
} from "./pay-sheet.ts";
import type { Accrual, Allocation, Component, Payment } from "./types.ts";

const component = (kind: string, amount: number | null, label = kind, basis = ""): Component => ({
  kind,
  label,
  amount,
  basis,
  source: "",
});
const accrual = (
  id: string,
  date: string,
  components: Component[],
  snapshot: Record<string, unknown> = {},
): Accrual => ({
  id,
  employee_id: "e1",
  business_date: date,
  period_id: "p",
  rule_version_id: null,
  components,
  salary: components
    .filter((c) => c.kind !== "tips")
    .reduce((sum, c) => sum + (c.amount ?? 0), 0),
  tips: 0,
  status: "ready",
  issues: [],
  calculation_snapshot: snapshot,
  updated_at: "2026-10-31T00:00:00Z",
});
const role = () => "Бармен";

test("buildPaySheet groups shift components and keeps deductions apart", () => {
  const sheet = buildPaySheet(
    [
      accrual("a1", "2026-10-28", [
        component("base", 2500, "Выход", "2 сотрудников · среда"),
        component("percent", 3000, "Процент от продаж", "60 000 ₽ × 5% · бар"),
        component("tips", 900),
      ]),
      accrual("a2", "2026-10-29", [
        component("base", 2500, "Выход", "2 сотрудников · четверг"),
        component("deduction", -1000, "Опоздание на смену"),
        component("bonus", 2000, "За банкет"),
      ]),
      accrual("old", "2026-09-30", [component("base", 9999)]),
    ],
    "2026-10-01",
    role,
  );
  assert.deepEqual(
    sheet.groups.map((g) => [g.id, g.amount, g.items.length]),
    [
      ["base", 5000, 2],
      ["percent", 3000, 1],
      ["bonus", 2000, 1],
    ],
  );
  assert.equal(sheet.earned, 10000);
  assert.equal(sheet.deducted, -1000);
  assert.equal(sheet.deductions[0].title, "Опоздание на смену");
  assert.equal(sheet.shifts, 2);
  // Свежие даты первыми, у выхода в строке должность, у ручной записи основание.
  assert.equal(sheet.groups[0].items[0].date, "2026-10-29");
  assert.equal(sheet.groups[0].items[0].title, "Бармен");
  assert.equal(sheet.groups[0].uniform, 2500);
  assert.equal(sheet.groups[2].items[0].title, "За банкет");
});

test("buildPaySheet: unknown amount hides the group total, the month shows what is known", () => {
  const sheet = buildPaySheet(
    [
      accrual("a1", "2026-10-28", [
        component("base", 2500),
        component("percent", null, "Процент от продаж", "— ₽ × 5%"),
      ]),
    ],
    "2026-10-01",
    role,
  );
  assert.equal(sheet.groups.find((g) => g.id === "percent")?.amount, null);
  assert.equal(sheet.earned, 2500);
  assert.deepEqual(sheet.pending, ["percent"]);
  assert.equal(pendingEarnedHint(sheet.pending), "Без процента от продаж — ещё считаются");
});

test("pendingEarnedHint names up to two groups, otherwise speaks generally", () => {
  assert.equal(pendingEarnedHint([]), null);
  assert.equal(pendingEarnedHint(["extra"]), "Без допродаж — ещё считаются");
  assert.equal(pendingEarnedHint(["percent", "extra"]), "Без процента от продаж и допродаж — ещё считаются");
  assert.equal(pendingEarnedHint(["other:Бонус"]), "Без части начислений — ещё считаются");
});

test("buildPaySheet drops zero groups and counts only real shifts", () => {
  const sheet = buildPaySheet(
    [
      accrual("a1", "2026-10-28", [component("base", 2500), component("experience", 0)]),
      accrual("m", "2026-10-01", [component("monthly", 40000)], { kind: "monthly" }),
      accrual("adj", "2026-10-05", [component("allowance", 5000, "KPI")], { kind: "adjustment" }),
    ],
    "2026-10-01",
    role,
  );
  assert.deepEqual(
    sheet.groups.map((g) => g.id),
    ["monthly", "base", "allowance"],
  );
  assert.equal(sheet.groups[1].uniform, 2500);
  assert.equal(sheet.shifts, 1);
});

test("buildPaySheet: different amounts have no uniform rate, cents sum exactly", () => {
  const sheet = buildPaySheet(
    [
      accrual("a1", "2026-10-28", [component("base", 0.1)]),
      accrual("a2", "2026-10-29", [component("base", 0.2)]),
    ],
    "2026-10-01",
    role,
  );
  assert.equal(sheet.groups[0].uniform, null);
  assert.equal(sheet.groups[0].amount, 0.3);
});

test("paySheetPayments takes only this employee's share for the month", () => {
  const payments: Payment[] = [
    { id: "p1", transaction_id: null, cashbox_id: null, kind: "salary", amount: 100000, state: "posted", note: "", occurred_at: "2026-10-15T10:00:00Z", created_at: "" },
    { id: "p2", transaction_id: null, cashbox_id: null, kind: "advance", amount: 20000, state: "cancelled", note: "", occurred_at: "2026-10-25T10:00:00Z", created_at: "" },
    { id: "p3", transaction_id: null, cashbox_id: null, kind: "salary", amount: 5000, state: "posted", note: "", occurred_at: "2026-10-20T10:00:00Z", created_at: "" },
  ];
  const allocations: Allocation[] = [
    { employee_id: "e1", payment_id: "p1", accrual_id: null, month: "2026-10-01", amount: 40000, settled_amount: 46000 },
    { employee_id: "e2", payment_id: "p1", accrual_id: null, month: "2026-10-01", amount: 60000, settled_amount: 60000 },
    { employee_id: "e1", payment_id: "p2", accrual_id: null, month: "2026-10-01", amount: 20000, settled_amount: 20000 },
    { employee_id: "e1", payment_id: "p3", accrual_id: null, month: "2026-09-01", amount: 5000, settled_amount: 5000 },
  ];
  assert.deepEqual(paySheetPayments(payments, allocations, "e1", "2026-10-01"), [
    { id: "p2", date: "2026-10-25T10:00:00Z", kind: "advance", posted: false, amount: 20000, official: false, agency: false, tax: 0 },
    // Налог группы на нескольких сотрудников не приписывается одному.
    { id: "p1", date: "2026-10-15T10:00:00Z", kind: "salary", posted: true, amount: 46000, official: false, agency: false, tax: 0 },
  ]);
});

test("paySheetPayments: официальная выплата закрывает оклад, налог — разница", () => {
  const payments: Payment[] = [
    { id: "o1", transaction_id: null, cashbox_id: null, kind: "salary", amount: 69600, state: "posted", note: "", occurred_at: "2026-12-05T09:00:00Z", created_at: "", official_month: "2026-11-01" },
  ];
  const allocations: Allocation[] = [
    { employee_id: "e1", payment_id: "o1", accrual_id: null, month: "2026-11-01", amount: 69600, settled_amount: 80000 },
  ];
  assert.deepEqual(paySheetPayments(payments, allocations, "e1", "2026-11-01"), [
    { id: "o1", date: "2026-12-05T09:00:00Z", kind: "salary", posted: true, amount: 80000, official: true, agency: false, tax: 10400 },
  ]);
});

test("paySheetPayments: запись через агентство закрывает сумму без налога", () => {
  const payments: Payment[] = [
    { id: "g1", transaction_id: null, cashbox_id: null, kind: "salary", amount: 4350, state: "posted", note: "Получено через агентство за ноябрь 2026", occurred_at: "2026-12-05T09:00:00Z", created_at: "", official_month: "2026-11-01", agency: true },
  ];
  const allocations: Allocation[] = [
    { employee_id: "e1", payment_id: "g1", accrual_id: null, month: "2026-11-01", amount: 4350, settled_amount: 4350 },
  ];
  assert.deepEqual(paySheetPayments(payments, allocations, "e1", "2026-11-01"), [
    { id: "g1", date: "2026-12-05T09:00:00Z", kind: "salary", posted: true, amount: 4350, official: true, agency: true, tax: 0 },
  ]);
});

test("payMonthHistory ends at the given month and respects the start of accounting", () => {
  const accruals = [
    accrual("a1", "2026-09-10", [component("base", 1000)]),
    accrual("a2", "2026-10-10", [component("base", 2000)]),
    accrual("a3", "2026-10-11", [component("base", 500)]),
  ];
  assert.deepEqual(payMonthHistory(accruals, "2026-11-01", "2026-09-01", 6), [
    { month: "2026-09-01", earned: 1000 },
    { month: "2026-10-01", earned: 2500 },
    { month: "2026-11-01", earned: 0 },
  ]);
});

test("shiftMonth crosses the year boundary", () => {
  assert.equal(shiftMonth("2026-12-01", 1), "2027-01-01");
  assert.equal(shiftMonth("2026-01-15", -1), "2025-12-01");
});
