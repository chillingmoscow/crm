import assert from "node:assert/strict";
import test from "node:test";

import {
  applyResultSnapshot,
  hasResultSnapshot,
  type InventoryResultSnapshotRow,
} from "./results-snapshot.ts";

// Строка из прода: акт СВ340, «Стандарт / Palitra / Mango Cream».
// В снимке — то, что видел проверяющий (расчёт 0,2 = факт, разница 0);
// в живых колонках — то, что позже отдал QR (расчёт −0,4, излишек 0,6 кг).
const mangoCream: InventoryResultSnapshotRow = {
  actual_amount: 0.2,
  calculated_amount: -0.4,
  difference_amount: 0.6,
  difference_sum: 4350,
  prime_cost: 7250,
  finalized_actual_amount: 0.2,
  finalized_calculated_amount: 0.2,
  finalized_difference_amount: 0,
  finalized_difference_sum: 0,
  finalized_prime_cost: 7250,
};

test("акт зафиксирован → показываем снимок, а не живые значения из QR", () => {
  const out = applyResultSnapshot(mangoCream, true);
  assert.equal(out.results_frozen, true);
  assert.equal(out.calculated_amount, 0.2);
  assert.equal(out.difference_amount, 0);
  assert.equal(out.difference_sum, 0);
});

test("акт не зафиксирован → живые значения", () => {
  const out = applyResultSnapshot(mangoCream, false);
  assert.equal(out.results_frozen, false);
  assert.equal(out.calculated_amount, -0.4);
  assert.equal(out.difference_sum, 4350);
});

test("строка добавлена после снятия снимка → живые значения", () => {
  const fresh: InventoryResultSnapshotRow = {
    actual_amount: 1,
    calculated_amount: 2,
    difference_amount: -1,
    difference_sum: -100,
    prime_cost: 100,
  };
  const out = applyResultSnapshot(fresh, true);
  assert.equal(out.results_frozen, false);
  assert.equal(out.calculated_amount, 2);
  assert.equal(hasResultSnapshot(fresh), false);
});

test("пустое поле снимка не подтягивает живое значение", () => {
  const row: InventoryResultSnapshotRow = {
    actual_amount: 3,
    calculated_amount: 5,
    difference_amount: -2,
    difference_sum: -200,
    prime_cost: 100,
    finalized_actual_amount: 3,
    finalized_calculated_amount: null,
    finalized_difference_amount: null,
    finalized_difference_sum: null,
    finalized_prime_cost: 100,
  };
  const out = applyResultSnapshot(row, true);
  assert.equal(out.results_frozen, true);
  assert.equal(out.calculated_amount, null);
  assert.equal(out.difference_amount, null);
});

test("исходная строка не мутируется", () => {
  const row = { ...mangoCream };
  applyResultSnapshot(row, true);
  assert.equal(row.calculated_amount, -0.4);
});

test("hasResultSnapshot: достаточно одного заполненного поля", () => {
  assert.equal(hasResultSnapshot({ finalized_difference_sum: 0 }), true);
  assert.equal(hasResultSnapshot({ finalized_difference_sum: null }), false);
  assert.equal(hasResultSnapshot({}), false);
});
