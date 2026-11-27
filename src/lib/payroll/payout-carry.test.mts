import test from "node:test";
import assert from "node:assert/strict";
import { carryItems, carryWaiting } from "./payout-carry.ts";
import type { Accrual, Allocation, OfficialExpected, PayEmployee, Payment } from "./types.ts";

const MONTH = "2026-11-01";

function employee(id: string): PayEmployee {
  return {
    id, account_id: "a", venue_id: "v", quickresto_id: null, name: id, local_user_id: null,
    role_name: "Бармен", model_id: null, hired_on: null, experience_offset_months: 0,
    active: true, opening_balance: 0, opening_confirmed: true,
  };
}
function accrual(employee_id: string, salary: number): Accrual {
  return {
    id: `acc-${employee_id}`, employee_id, business_date: "2026-11-10", period_id: "p", rule_version_id: null,
    components: [], salary, tips: 0, status: "approved", issues: [], calculation_snapshot: { kind: "shift" }, updated_at: "",
  };
}
function paid(employee_id: string, amount: number): { payment: Payment; allocation: Allocation } {
  const id = `pay-${employee_id}`;
  return {
    payment: { id, transaction_id: null, cashbox_id: null, kind: "salary", amount, state: "posted", note: "",
      occurred_at: "2026-12-12T10:00:00Z", created_at: "2026-12-12T10:00:00Z" },
    allocation: { employee_id, payment_id: id, accrual_id: null, month: MONTH, amount, settled_amount: amount },
  };
}
function data(o: { accruals: Accrual[]; paid?: ReturnType<typeof paid>[]; official?: OfficialExpected[] }) {
  return {
    employees: [employee("gamlet"), employee("anna"), employee("olga")],
    accruals: o.accruals,
    adjustments: [],
    payments: (o.paid ?? []).map((p) => p.payment),
    allocations: (o.paid ?? []).map((p) => p.allocation),
    transfers: [],
    settings: { starts_on: "2026-09-01" } as never,
    officialExpected: o.official ?? [],
  };
}

test("перенос: недоплата и переплата — со знаком и причиной", () => {
  const items = carryItems(
    data({
      accruals: [accrual("gamlet", 100000), accrual("anna", 50000)],
      paid: [paid("gamlet", 97000), paid("anna", 52000)],
    }),
    MONTH,
    ["gamlet", "anna"],
  );
  assert.deepEqual(items, [
    { employee_id: "gamlet", amount: 3000, reason: "Недоплата за ноябрь 2026: переносится к выплате за декабрь 2026" },
    { employee_id: "anna", amount: -2000, reason: "Переплата за ноябрь 2026: удерживается из выплаты за декабрь 2026" },
  ]);
});

test("перенос: нулевой остаток и сотрудники вне плана не переносятся", () => {
  const items = carryItems(
    data({ accruals: [accrual("gamlet", 100000), accrual("olga", 40000)], paid: [paid("gamlet", 100000)] }),
    MONTH,
    ["gamlet"],
  );
  assert.deepEqual(items, []);
});

test("перенос: переплата из-за непроведённой официальной части не переносится", () => {
  const items = carryItems(
    data({
      accruals: [accrual("anna", 50000)],
      paid: [paid("anna", 40000)],
      official: [{ employee_id: "anna", employment_id: "e", month: MONTH, kind: "full", gross: 27500, days_paid: null, days_in_month: 30 } as OfficialExpected],
    }),
    MONTH,
    ["anna"],
  );
  assert.deepEqual(items, []);
});

test("перенос ждёт строку, если невыданное по плану ещё причитается", () => {
  const rows = [
    { employee_id: "gamlet", amount: 45000, issued: 25000, state: "partial" },
    { employee_id: "anna", amount: 30000, issued: 30000, state: "issued" },
    { employee_id: "olga", amount: 0, issued: 0, state: "planned" },
  ];
  assert.deepEqual(carryWaiting(rows, new Map([["gamlet", 20000]])), [{ employee_id: "gamlet", remainder: 20000 }]);
  // Остаток выплатили вручную — свежий расчёт меньше невыданного, строка закрыта.
  assert.deepEqual(carryWaiting(rows, new Map([["gamlet", 0]])), []);
});
