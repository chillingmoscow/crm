import test from "node:test";
import assert from "node:assert/strict";
import {
  officialExpectedNote,
  officialGrossFromNet,
  officialNet,
  officialPartLabel,
  officialPayBy,
  officialPaymentLabel,
  officialTax,
} from "./official.ts";

test("НДФЛ 13% до рубля, на руки — оклад минус налог", () => {
  assert.equal(officialTax(80000), 10400);
  assert.equal(officialNet(80000), 69600);
  assert.equal(officialNet(27500), 23925);
  // Павлов с 03.11: 80 000 × 28/30.
  assert.equal(officialTax(74666.67), 9707);
  assert.equal(officialNet(74666.67), 64959.67);
});

test("оклад с налогом по сумме на руки", () => {
  assert.equal(officialGrossFromNet(69600), 80000);
  assert.equal(officialGrossFromNet(23925), 27500);
  assert.equal(officialGrossFromNet(64959.67), 74666.67);
  assert.equal(officialGrossFromNet(0), 0);
  // Обратный пересчёт сходится и там, где деление на 0,87 даёт не тот рубль налога.
  for (const net of [25785, 60900, 1000.01, 12345.67, 99999.99]) {
    assert.equal(officialNet(officialGrossFromNet(net)), net, String(net));
  }
});

test("срок выплаты — до 7 числа следующего месяца", () => {
  assert.equal(officialPayBy("2026-11-01"), "до 7 декабря");
  assert.equal(officialPayBy("2026-12-01"), "до 7 января");
});

test("подпись ожидаемой части: полный, первый и последний месяц", () => {
  const base = { amount: 80000, days_paid: null, days_in_month: 30 };
  assert.equal(
    officialExpectedNote({ ...base, kind: "full" }, "2026-11-01"),
    "выплатит бухгалтерия до 7 декабря",
  );
  assert.equal(
    officialExpectedNote({ ...base, kind: "first", amount: 74666.67, days_paid: 28 }, "2026-11-01"),
    "за 28 из 30 дней · выплатит бухгалтерия до 7 декабря",
  );
  assert.equal(
    officialExpectedNote({ ...base, kind: "first", amount: 2580.65, days_paid: 1, days_in_month: 31 }, "2026-12-01"),
    "за 1 из 31 дня · выплатит бухгалтерия до 7 января",
  );
  assert.equal(
    officialExpectedNote({ ...base, kind: "final", amount: null }, "2026-11-01"),
    "сумма уточняется",
  );
});

test("подпись ожидаемой части через агентство: без бухгалтерии и срока", () => {
  const base = { amount: 4350, days_paid: null, days_in_month: 30, agency: true };
  assert.equal(officialExpectedNote({ ...base, kind: "full" }, "2026-11-01"), "получит через агентство");
  assert.equal(
    officialExpectedNote({ ...base, kind: "first", amount: 2175, days_paid: 15 }, "2026-11-01"),
    "за 15 из 30 дней · получит через агентство",
  );
  assert.equal(officialExpectedNote({ ...base, kind: "final", amount: null }, "2026-11-01"), "сумма уточняется");
});

test("названия официальной части и записи через агентство", () => {
  assert.equal(officialPartLabel(false), "Официальная часть");
  assert.equal(officialPartLabel(true), "Через агентство");
  assert.equal(officialPaymentLabel(undefined), "Официальная");
  assert.equal(officialPaymentLabel(true), "Через агентство");
});

// ── Ожидаемая часть в остатке ведомости ───────────────────────
import { statementRows, transferableBalance } from "./calculate.ts";
import type { Accrual, Allocation, OfficialExpected, PayEmployee, Payment } from "./types.ts";

const employee: PayEmployee = {
  id: "e1",
  account_id: "a",
  venue_id: "v",
  quickresto_id: null,
  name: "Павлов",
  local_user_id: null,
  role_name: "Старший бармен",
  model_id: null,
  hired_on: null,
  experience_offset_months: 0,
  active: true,
  opening_balance: 0,
  opening_confirmed: true,
};
const earned = (amount: number): Accrual => ({
  id: `acc-${amount}`,
  employee_id: "e1",
  business_date: "2026-11-10",
  period_id: "p",
  rule_version_id: null,
  components: [{ kind: "base", label: "Выход", amount, basis: "", source: "" }],
  salary: amount,
  tips: 0,
  status: "approved",
  issues: [],
  calculation_snapshot: { kind: "shift" },
  updated_at: "",
});
const expected = (over: Partial<OfficialExpected> = {}): OfficialExpected => ({
  employee_id: "e1",
  employment_id: "oe1",
  month: "2026-11-01",
  kind: "full",
  gross: 80000,
  days_paid: null,
  days_in_month: 30,
  agency: false,
  ...over,
});
const rowFor = (
  accruals: Accrual[],
  official: OfficialExpected[],
  payments: Payment[] = [],
  allocations: Allocation[] = [],
) =>
  statementRows([employee], accruals, [], payments, allocations, "2026-11-01", [], "2026-09-01", official)[0];

test("ожидаемая официальная часть уменьшает остаток к выплате", () => {
  const row = rowFor([earned(100000)], [expected()]);
  assert.equal(row.remaining, 20000);
  assert.deepEqual(row.officialExpected, { amount: 80000, kind: "full", days_paid: null, days_in_month: 30, agency: false });
});

test("официальная часть больше заработанного — переплата, без ошибки", () => {
  const row = rowFor([earned(20000)], [expected({ gross: 27500 })]);
  assert.equal(row.remaining, -7500);
});

test("последний месяц: сумма неизвестна, остаток не меняется", () => {
  const row = rowFor([earned(100000)], [expected({ kind: "final", gross: null })]);
  assert.equal(row.remaining, 100000);
  assert.equal(row.officialExpected?.amount, null);
  assert.equal(row.officialExpected?.kind, "final");
});

test("через агентство: сумма месяца уменьшает остаток, метка доходит до строки", () => {
  const row = rowFor([earned(10000)], [expected({ gross: 4350, agency: true })]);
  assert.equal(row.remaining, 5650);
  assert.equal(row.officialExpected?.agency, true);
});

test("первый месяц: пропорциональная сумма и дни", () => {
  const row = rowFor([earned(100000)], [expected({ kind: "first", gross: 74666.67, days_paid: 28 })]);
  assert.equal(row.remaining, 25333.33);
  assert.deepEqual(row.officialExpected, { amount: 74666.67, kind: "first", days_paid: 28, days_in_month: 30, agency: false });
});

test("ожидание другого месяца или сотрудника не учитывается", () => {
  const row = rowFor([earned(100000)], [expected({ month: "2026-10-01" }), expected({ employee_id: "e2" })]);
  assert.equal(row.remaining, 100000);
  assert.equal(row.officialExpected, null);
});

test("сотрудник без смен, но с ожидаемой частью остаётся в ведомости", () => {
  const rows = statementRows(
    [{ ...employee, active: false }],
    [],
    [],
    [],
    [],
    "2026-11-01",
    [],
    "2026-09-01",
    [expected()],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].remaining, -80000);
});

test("перенос: переплату из-за ожидаемой официальной части перенести нельзя", () => {
  // Заработано 20 000, ожидается 27 500: в базе остаток +20 000, переплаты там нет.
  assert.deepEqual(transferableBalance(rowFor([earned(20000)], [expected({ gross: 27500 })])), {
    amount: 0,
    blockedByOfficial: true,
  });
  // Заработано 100 000, выплачено 30 000, ожидается 80 000.
  const payments: Payment[] = [
    { id: "p1", transaction_id: null, cashbox_id: null, kind: "salary", amount: 30000, state: "posted", note: "", occurred_at: "2026-11-20T10:00:00Z", created_at: "" },
  ];
  const allocations: Allocation[] = [
    { employee_id: "e1", payment_id: "p1", accrual_id: null, month: "2026-11-01", amount: 30000, settled_amount: 30000 },
  ];
  assert.equal(transferableBalance(rowFor([earned(100000)], [expected()], payments, allocations)).blockedByOfficial, true);
  // К выплате после официальной части переносится как раньше.
  assert.deepEqual(transferableBalance(rowFor([earned(100000)], [expected()])), { amount: 20000, blockedByOfficial: false });
  // Последний месяц (сумма неизвестна) и обычная переплата не блокируются.
  assert.deepEqual(transferableBalance(rowFor([earned(100000)], [expected({ kind: "final", gross: null })], payments.map((p) => ({ ...p, amount: 130000 })), allocations.map((a) => ({ ...a, amount: 130000, settled_amount: 130000 })))), { amount: 30000, blockedByOfficial: false });
  assert.deepEqual(transferableBalance(rowFor([], [], payments, allocations)), { amount: 30000, blockedByOfficial: false });
});
