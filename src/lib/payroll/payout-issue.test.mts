import { test } from "node:test";
import assert from "node:assert/strict";
import type { CashControlReport } from "../sales/cash-control.ts";
import {
  autoIssueDecision,
  autoReportText,
  cashAvailable,
  distributeCash,
  payoutMessage,
  registerCash,
  type DueRow,
} from "./payout-issue.ts";

let id = 0;
function report(o: Partial<CashControlReport>): CashControlReport {
  return {
    id: ++id, shiftNumber: id, openedAt: "2026-11-25T09:00:00+03:00", closedAt: null,
    terminalId: "A", terminal: "Бар", cashier: "Гамлет", status: "OPENED", incomplete: false,
    openExpected: null, openDeclared: null, closeExpected: null, closeDeclared: null, ...o,
  };
}
const due = (row_id: string, name: string, amount: number, next: string | null = null): DueRow =>
  ({ row_id, employee_id: row_id, name, due: amount, next_pay_date: next });

test("registerCash: open shift today wins, else last closed; kopecks → rubles", () => {
  const cash = registerCash(
    [
      report({ terminalId: "A", status: "CLOSED", closedAt: "2026-11-25T08:00:00+03:00", closeExpected: 9900000 }),
      report({ terminalId: "A", status: "OPENED", openExpected: 15000000 }),
    ],
    [
      report({ terminalId: "B", terminal: "Зал", status: "CLOSED", closedAt: "2026-11-24T20:00:00+03:00", closeExpected: 3000000 }),
      report({ terminalId: "B", terminal: "Зал", status: "CLOSED", closedAt: "2026-11-24T23:30:00+03:00", closeExpected: 4000000 }),
    ],
  );
  assert.deepEqual(
    cash?.map((r) => [r.terminalId, r.amount, r.source]),
    [["A", 150000, "open"], ["B", 40000, "close"]],
  );
});

test("registerCash: today's closed report is used before yesterday's", () => {
  const cash = registerCash(
    [report({ terminalId: "A", status: "CLOSED", closedAt: "2026-11-25T12:00:00+03:00", closeExpected: 5000000 })],
    [report({ terminalId: "A", status: "CLOSED", closedAt: "2026-11-24T23:00:00+03:00", closeExpected: 1000000 })],
  );
  assert.deepEqual(cash?.map((r) => r.amount), [50000]);
});

test("registerCash: register without a value is skipped; empty terminalId groups by title", () => {
  const cash = registerCash(
    [report({ terminalId: "", terminal: "Касса 2", openExpected: 100000 }), report({ terminalId: "C", openExpected: null })],
    [],
  );
  assert.deepEqual(cash?.map((r) => [r.terminal, r.amount]), [["Касса 2", 1000]]);
});

test("registerCash: no reports today or yesterday → null", () => {
  assert.equal(registerCash([], []), null);
  assert.equal(registerCash([report({ openExpected: null })], []), null);
});

test("cashAvailable: 310 000 − 120 000 − 0 = 190 000; never below 0", () => {
  const regs = [
    { terminalId: "A", terminal: "Бар", amount: 150000, source: "open" as const, at: "" },
    { terminalId: "B", terminal: "Зал", amount: 160000, source: "close" as const, at: "" },
  ];
  assert.equal(cashAvailable(regs, 120000, 0), 190000);
  assert.equal(cashAvailable(regs, 120000, 50000), 140000);
  assert.equal(cashAvailable(regs, 400000, 0), 0);
});

test("distributeCash: smallest first, full while fits, next partial by step, rest nothing", () => {
  const { lines, short } = distributeCash(
    [due("g", "Гамлет", 65000), due("f", "Филипп", 45000), due("c", "Кристина", 30000), due("x", "Ян", 80000)],
    100000, 5000,
  );
  assert.deepEqual(lines.map((l) => [l.name, l.amount]), [["Кристина", 30000], ["Филипп", 45000], ["Гамлет", 25000]]);
  assert.deepEqual(short.map((r) => r.name), ["Гамлет", "Ян"]);
});

test("fully issued line keeps no next day; only a partial line moves on", () => {
  const { lines } = distributeCash([due("c", "Кристина", 30000, "2026-11-28"), due("g", "Гамлет", 65000, "2026-11-27")], 50000, 5000);
  assert.deepEqual(lines.map((l) => [l.name, l.amount, l.next_pay_date]), [["Кристина", 30000, null], ["Гамлет", 20000, "2026-11-27"]]);
});

test("partial keeps remainder: line amount < due and next_pay_date carried", () => {
  const { lines, short } = distributeCash([due("g", "Гамлет", 65000, "2026-11-27")], 27000, 5000);
  assert.equal(lines[0].amount, 25000);
  assert.equal(lines[0].next_pay_date, "2026-11-27");
  assert.equal(short[0].row_id, "g");
});

test("distributeCash with available ≤ 0 → no lines", () => {
  assert.deepEqual(distributeCash([due("g", "Гамлет", 65000)], 0, 5000).lines, []);
  assert.deepEqual(distributeCash([due("g", "Гамлет", 65000)], -100, 5000).lines, []);
  // меньше шага — частичная строка не появляется
  assert.deepEqual(distributeCash([due("g", "Гамлет", 65000)], 4000, 5000).lines, []);
});

test("payoutMessage", () => {
  assert.equal(
    payoutMessage([{ name: "Гамлет Геворкян", amount: 65000 }, { name: "Хасият Алиева", amount: 7500 }]),
    "Выдайте плиз и проведите:\nГамлет Геворкян — 65К\nХасият Алиева — 7 500\nИтого 72 500 — одним изъятием, в комментарии «ЗП»",
  );
  assert.equal(
    payoutMessage([{ name: "Гамлет", amount: 65000 }, { name: "Филипп", amount: 45000 }]),
    "Выдайте плиз и проведите:\nГамлет — 65К\nФилипп — 45К\nИтого 110К — одним изъятием, в комментарии «ЗП»",
  );
});

test("distributeCash: a capped row given its whole due closes the row", () => {
  const capped = { ...due("g", "Гамлет", 10000), capped: true };
  const { lines } = distributeCash([capped, due("f", "Филипп", 20000)], 100000, 5000);
  assert.deepEqual(lines.map((l) => [l.name, l.amount, l.close]), [["Гамлет", 10000, true], ["Филипп", 20000, false]]);
  // Частичная выдача урезанной строки её не закрывает.
  assert.equal(distributeCash([{ ...due("g", "Гамлет", 10000), capped: true }], 5000, 5000).lines[0].close, false);
});

test("autoIssueDecision: nobody due today is skipped silently, other problems are reported", () => {
  assert.equal(autoIssueDecision({ problem: "Сегодня по плану выдавать некому" }), "skip");
  assert.equal(autoIssueDecision({ problem: "Нет данных о наличных в кассах" }), "report");
  assert.equal(autoIssueDecision({ problem: "В кассах меньше минимума" }), "report");
  assert.equal(autoIssueDecision({ problem: null }), "issue");
});

test("autoReportText names the day, the reason and what to do", () => {
  assert.equal(
    autoReportText("CHILLING MOSCOW", "2026-11-25", "Нет данных о наличных в кассах", ["Филипп Смирнов", "Никита Волков"]),
    "Зарплата 25.11, CHILLING MOSCOW: выдача по плану не проведена. Нет данных о наличных в кассах.\n" +
      "Ждут выдачи: Филипп Смирнов, Никита Волков.\n" +
      "Выдайте вручную: Зарплата → План выплат → «Выдать сейчас».",
  );
});
