import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isMatched,
  nextDay,
  parseBankBalance,
  reconciliationDiff,
  reconciliationState,
  searchWindow,
  dayInZone,
  transactionsSearchHref,
  type ReconciliationRecord,
} from "./bank-reconciliation.ts";

function rec(partial: Partial<ReconciliationRecord>): ReconciliationRecord {
  return {
    id: "r",
    balance_date: "2026-11-20",
    bank_balance: 0,
    calculated_balance: 0,
    current_calculated_balance: 0,
    source: "manual",
    note: null,
    created_at: "2026-11-21T10:00:00Z",
    created_by: null,
    created_by_name: null,
    ...partial,
  };
}

test("разница — банк минус расчёт, в копейках без хвостов", () => {
  assert.equal(reconciliationDiff(100.3, 100.1), 0.2);
  assert.equal(reconciliationDiff(0.1 + 0.2, 0.3), 0);
  assert.equal(reconciliationDiff(-500, 250.5), -750.5);
  assert.equal(isMatched(reconciliationDiff(0.1 + 0.2, 0.3)), true);
  assert.equal(isMatched(0.01), false);
});

test("состояние: сошлось и не менялось", () => {
  const s = reconciliationState(rec({ bank_balance: 1000, calculated_balance: 1000, current_calculated_balance: 1000 }));
  assert.deepEqual(s, { diff: 0, matched: true, changedSince: false, currentDiff: 0, currentMatched: true });
});

test("состояние: сошлось, потом операции до даты поменяли", () => {
  const s = reconciliationState(rec({ bank_balance: 1000, calculated_balance: 1000, current_calculated_balance: 800 }));
  assert.equal(s.matched, true);
  assert.equal(s.changedSince, true);
  assert.equal(s.currentDiff, 200);
  assert.equal(s.currentMatched, false);
});

test("состояние: не сошлось, потом исправили операции", () => {
  const s = reconciliationState(rec({ bank_balance: 1000, calculated_balance: 900, current_calculated_balance: 1000 }));
  assert.equal(s.matched, false);
  assert.equal(s.diff, 100);
  assert.equal(s.changedSince, true);
  assert.equal(s.currentMatched, true);
});

test("состояние: текущий расчёт недоступен", () => {
  const s = reconciliationState(rec({ bank_balance: 1, calculated_balance: 1, current_calculated_balance: null }));
  assert.equal(s.changedSince, false);
  assert.equal(s.currentDiff, null);
  assert.equal(s.currentMatched, false);
});

test("следующий день через границы месяца и года", () => {
  assert.equal(nextDay("2026-11-30"), "2026-12-01");
  assert.equal(nextDay("2026-12-31"), "2027-01-01");
  assert.equal(nextDay("2028-02-28"), "2028-02-29");
});

test("период поиска — со дня после последней сходящейся сейчас сверки", () => {
  const rows = [
    rec({ id: "a", balance_date: "2026-11-10", bank_balance: 5, calculated_balance: 5, current_calculated_balance: 5 }),
    rec({ id: "b", balance_date: "2026-11-15", bank_balance: 5, calculated_balance: 5, current_calculated_balance: 5 }),
    // сошлась тогда, но операции поменяли — не опора
    rec({ id: "c", balance_date: "2026-11-17", bank_balance: 5, calculated_balance: 5, current_calculated_balance: 7 }),
    // на ту же дату, что ищем, — не опора
    rec({ id: "d", balance_date: "2026-11-20", bank_balance: 5, calculated_balance: 5, current_calculated_balance: 5 }),
  ];
  assert.deepEqual(searchWindow(rows, "2026-11-20"), { from: "2026-11-16", to: "2026-11-20", matchedOn: "2026-11-15" });
});

test("период поиска без сошедшихся сверок — с начала", () => {
  const rows = [rec({ balance_date: "2026-11-01", bank_balance: 5, calculated_balance: 4, current_calculated_balance: 4 })];
  assert.deepEqual(searchWindow(rows, "2026-11-20"), { from: null, to: "2026-11-20", matchedOn: null });
  assert.deepEqual(searchWindow([], "2026-11-20"), { from: null, to: "2026-11-20", matchedOn: null });
});

test("ссылка в «Транзакции» с фильтром счёта и периода", () => {
  assert.equal(
    transactionsSearchHref("ba-1", { from: "2026-11-16", to: "2026-11-20" }),
    "/finance/transactions?bank_account_id=ba-1&date_from=2026-11-16&date_to=2026-11-20",
  );
  assert.equal(
    transactionsSearchHref("ba-1", { from: null, to: "2026-11-20" }),
    "/finance/transactions?bank_account_id=ba-1&date_to=2026-11-20",
  );
});

test("сегодня — по календарю пояса аккаунта", () => {
  const lateUtc = new Date("2026-11-20T22:30:00Z");
  assert.equal(dayInZone("Europe/Moscow", lateUtc), "2026-11-21");
  assert.equal(dayInZone("UTC", lateUtc), "2026-11-20");
});

test("остаток из поля ввода", () => {
  assert.equal(parseBankBalance("1 234,56"), 1234.56);
  assert.equal(parseBankBalance("−615 579,50"), -615579.5);
  assert.equal(parseBankBalance("-10"), -10);
  assert.equal(parseBankBalance("1 000"), 1000);
  assert.equal(parseBankBalance("0"), 0);
  assert.equal(parseBankBalance(""), null);
  assert.equal(parseBankBalance("12,345"), null);
  assert.equal(parseBankBalance("abc"), null);
  assert.equal(parseBankBalance("1.2.3"), null);
});
