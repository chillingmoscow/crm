import test from "node:test";
import assert from "node:assert/strict";
import {
  canChangeOfficialAccount,
  canRecordOfficialPayment,
  officialAmountsError,
  officialBankFor,
  officialEmploymentFor,
  officialPaymentOption,
  officialTaxOf,
} from "./official-payment.ts";
import type { Allocation, OfficialEmploymentSpan, OfficialExpected, Payment, PayrollData } from "./types.ts";

const spans: OfficialEmploymentSpan[] = [
  { id: "oe-1", employee_id: "e-1", starts_on: "2026-11-03", ends_on: null },
  { id: "oe-2", employee_id: "e-2", starts_on: "2026-09-01", ends_on: "2026-10-31" },
];

test("период покрывает месяц так же, как проверка базы", () => {
  assert.equal(officialEmploymentFor(spans, "e-1", "2026-11-01")?.id, "oe-1");
  assert.equal(officialEmploymentFor(spans, "e-1", "2026-12-01")?.id, "oe-1");
  // До оформления — нет.
  assert.equal(officialEmploymentFor(spans, "e-1", "2026-10-01"), null);
  // Месяц увольнения ещё покрыт, следующий — нет.
  assert.equal(officialEmploymentFor(spans, "e-2", "2026-10-01")?.id, "oe-2");
  assert.equal(officialEmploymentFor(spans, "e-2", "2026-11-01"), null);
  assert.equal(officialEmploymentFor(spans, "e-3", "2026-11-01"), null);
});

const payment = (id: string, state: Payment["state"], official_month: string | null, created_at = "2026-12-05T09:00:00Z"): Payment => ({
  id,
  transaction_id: `t-${id}`,
  cashbox_id: null,
  kind: "salary",
  amount: 0,
  state,
  note: "",
  occurred_at: created_at,
  created_at,
  official_month,
});
const allocation = (payment_id: string, employee_id: string, amount: number, settled_amount: number): Allocation => ({
  payment_id,
  employee_id,
  accrual_id: null,
  month: "2026-11-01",
  amount,
  settled_amount,
});
const expected: OfficialExpected[] = [
  { employee_id: "e-1", employment_id: "oe-1", month: "2026-11-01", kind: "first", gross: 74666.67, days_paid: 28, days_in_month: 30 },
];
const base = { employments: spans, expected, payments: [] as Payment[], allocations: [] as Allocation[] };

test("переключатель только при одном получателе с периодом на месяц", () => {
  assert.deepEqual(officialPaymentOption({ ...base, employeeIds: [], month: "2026-11-01" }), { available: false });
  assert.deepEqual(officialPaymentOption({ ...base, employeeIds: ["e-1", "e-2"], month: "2026-11-01" }), { available: false });
  assert.deepEqual(officialPaymentOption({ ...base, employeeIds: ["e-1"], month: "2026-10-01" }), { available: false });
  assert.deepEqual(officialPaymentOption({ ...base, employeeIds: ["e-3"], month: "2026-11-01" }), { available: false });
});

test("ожидаемая часть подставляет оклад и сумму на руки", () => {
  assert.deepEqual(officialPaymentOption({ ...base, employeeIds: ["e-1"], month: "2026-11-01" }), {
    available: true,
    employmentId: "oe-1",
    blocked: null,
    gross: 74666.67,
    net: 64959.67,
  });
});

test("без периодов в данных период берётся из ожидаемой части", () => {
  const option = officialPaymentOption({ ...base, employments: [], employeeIds: ["e-1"], month: "2026-11-01" });
  assert.equal(option.available && option.employmentId, "oe-1");
});

test("проведённая официальная выплата за месяц блокирует повтор", () => {
  const option = officialPaymentOption({
    ...base,
    employeeIds: ["e-1"],
    month: "2026-11-01",
    payments: [payment("p-1", "posted", "2026-11-01")],
    allocations: [allocation("p-1", "e-1", 64959.67, 74666.67)],
  });
  assert.equal(option.available && option.blocked, "За этот месяц уже проведена официальная выплата");
  // Обычная выплата за тот же месяц не мешает.
  const ordinary = officialPaymentOption({
    ...base,
    employeeIds: ["e-1"],
    month: "2026-11-01",
    payments: [payment("p-2", "posted", null)],
    allocations: [allocation("p-2", "e-1", 10000, 10000)],
  });
  assert.equal(ordinary.available && ordinary.blocked, null);
});

test("после удаления подставляются суммы последней удалённой выплаты", () => {
  const option = officialPaymentOption({
    ...base,
    expected: [],
    employeeIds: ["e-1"],
    month: "2026-11-01",
    payments: [
      payment("p-old", "cancelled", "2026-11-01", "2026-12-05T09:00:00Z"),
      payment("p-new", "cancelled", "2026-11-01", "2026-12-06T09:00:00Z"),
    ],
    allocations: [allocation("p-old", "e-1", 60000, 68965.52), allocation("p-new", "e-1", 64959.67, 74666.67)],
  });
  assert.deepEqual(option, { available: true, employmentId: "oe-1", blocked: null, gross: 74666.67, net: 64959.67 });
});

test("месяц увольнения без суммы — поля пустые", () => {
  const option = officialPaymentOption({
    ...base,
    expected: [{ ...expected[0], kind: "final", gross: null }],
    employeeIds: ["e-1"],
    month: "2026-11-01",
  });
  assert.deepEqual(option, { available: true, employmentId: "oe-1", blocked: null, gross: null, net: null });
});

test("суммы официальной выплаты проверяются как в базе", () => {
  assert.equal(officialAmountsError(null, 80000), "Укажите сумму на руки и оклад с налогом");
  assert.equal(officialAmountsError(0, 80000), "Укажите сумму на руки и оклад с налогом");
  assert.equal(officialAmountsError(69600, 69599.99), "Сумма на руки больше оклада с налогом");
  assert.equal(officialAmountsError(69600.001, 80000), "Не больше двух знаков после запятой");
  assert.equal(officialAmountsError(69600, 80000), null);
  assert.equal(officialAmountsError(69600, 69600), null);
  assert.equal(officialTaxOf(64959.67, 74666.67), 9707);
  assert.equal(officialTaxOf(null, 80000), null);
});

test("права: смена счёта требует ещё и удаления операций", () => {
  assert.equal(canRecordOfficialPayment(["payroll.pay"]), false);
  assert.equal(canRecordOfficialPayment(["payroll.pay", "finance.create_transaction"]), true);
  assert.equal(canChangeOfficialAccount(["payroll.pay", "finance.create_transaction"]), false);
  assert.equal(
    canChangeOfficialAccount(["payroll.pay", "finance.create_transaction", "finance.delete_transaction"]),
    true,
  );
});

test("счёт официальной выплаты — только расчётный", () => {
  const banks: PayrollData["banks"] = [
    { id: "card", name: "Карта", legal_entity_id: "le", type: "debit_card" },
    { id: "rs-1", name: "Р/с 1", legal_entity_id: "le", type: "checking" },
    { id: "rs-2", name: "Р/с 2", legal_entity_id: "le", type: "checking" },
  ];
  assert.equal(officialBankFor(banks, "rs-2", "rs-1"), "rs-2");
  assert.equal(officialBankFor(banks, "card", "rs-2"), "rs-2");
  assert.equal(officialBankFor(banks, "card", "card"), "rs-1");
  assert.equal(officialBankFor(banks, "card", null), "rs-1");
  assert.equal(officialBankFor(banks.slice(0, 1), "card", null), "");
});
