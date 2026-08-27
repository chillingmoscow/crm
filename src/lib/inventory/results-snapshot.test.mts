import assert from "node:assert/strict";
import test from "node:test";

import {
  applyResortItemSnapshot,
  applyResortSnapshot,
  applyResultSnapshot,
  hasResultSnapshot,
  isInventoryResultFrozen,
  resultLineTotals,
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
  finalized_at: "2026-08-24T12:27:43Z",
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
    finalized_at: "2026-08-24T12:27:43Z",
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

test("снимок из одних null всё равно снимок: живые значения не подставляем", () => {
  // QR не вернул по строке ни одного расчётного поля — снимок легитимно пустой.
  // Без явного маркера такая строка выглядела бы как «снимка нет», и после
  // гонки «импорт прошёл проверку замка → финализация → импорт дописал строки»
  // залоченная страница показала бы новые живые числа.
  const row: InventoryResultSnapshotRow = {
    actual_amount: 1,
    calculated_amount: 2,
    difference_amount: -1,
    difference_sum: -100,
    prime_cost: 100,
    finalized_at: "2026-08-24T12:27:43Z",
    finalized_actual_amount: null,
    finalized_calculated_amount: null,
    finalized_difference_amount: null,
    finalized_difference_sum: null,
    finalized_prime_cost: null,
  };
  const out = applyResultSnapshot(row, true);
  assert.equal(out.results_frozen, true);
  assert.equal(out.actual_amount, null);
  assert.equal(out.calculated_amount, null);
  assert.equal(out.difference_sum, null);
});

test("hasResultSnapshot: смотрим на маркер, а не на значения", () => {
  assert.equal(hasResultSnapshot({ finalized_at: "2026-08-24T12:27:43Z" }), true);
  assert.equal(hasResultSnapshot({ finalized_difference_sum: 0 }), false);
  assert.equal(hasResultSnapshot({}), false);
});

// ── Пересорты и исключения в снимке (миграция 227) ──────────

test("пересорт зафиксированного акта берётся из снимка, включая статус", () => {
  // Пересорт свели на 2 кг, акт зафиксировали. Потом импорт пересчитал зачёт
  // (0,5 кг), а триггер-инвариант аннулировал пересорт — утверждённый итог
  // не должен поехать вслед за этим.
  const out = applyResortSnapshot(
    {
      status: "voided",
      offset_amount: 0.5,
      residual_shortfall_sum: -50,
      residual_surplus_sum: 0,
      cost_adjustment_sum: 10,
      finalized_at: "2026-08-24T12:27:43Z",
      finalized_status: "active",
      finalized_offset_amount: 2,
      finalized_residual_shortfall_sum: 0,
      finalized_residual_surplus_sum: 0,
      finalized_cost_adjustment_sum: 120,
    },
    true,
  );
  assert.equal(out.status, "active");
  assert.equal(out.offset_amount, 2);
  assert.equal(out.cost_adjustment_sum, 120);
});

test("пересорт без снимка остаётся живым (создать его на залоченном акте нельзя)", () => {
  const out = applyResortSnapshot(
    {
      status: "active",
      offset_amount: 3,
      residual_shortfall_sum: 0,
      residual_surplus_sum: 0,
      cost_adjustment_sum: 0,
    },
    true,
  );
  // Снимка нет — замораживать нечего, значения остаются живыми. Появиться на
  // зафиксированном акте такой пересорт не может: создание пересорта закрыто
  // замком итогов (getInventoryResultAdjustLockReason).
  assert.equal(out.offset_amount, 3);
  assert.equal(out.status, "active");
  assert.equal(out.finalized_at, undefined);
});

test("незафиксированный акт: пересорт показывается живым", () => {
  const row = {
    status: "active",
    offset_amount: 1,
    residual_shortfall_sum: -10,
    residual_surplus_sum: 0,
    cost_adjustment_sum: 0,
    finalized_at: "2026-08-24T12:27:43Z",
    finalized_status: "voided",
    finalized_offset_amount: 99,
    finalized_residual_shortfall_sum: 0,
    finalized_residual_surplus_sum: 0,
    finalized_cost_adjustment_sum: 0,
  };
  const out = applyResortSnapshot(row, false);
  assert.equal(out.status, "active");
  assert.equal(out.offset_amount, 1);
});

test("позиция пересорта из снимка", () => {
  const out = applyResortItemSnapshot(
    {
      source_difference_amount: -1,
      source_difference_sum: -100,
      offset_amount: 0.5,
      remaining_difference_amount: -0.5,
      remaining_difference_sum: -50,
      finalized_at: "2026-08-24T12:27:43Z",
      finalized_source_difference_amount: -2,
      finalized_source_difference_sum: -200,
      finalized_offset_amount: 2,
      finalized_remaining_difference_amount: 0,
      finalized_remaining_difference_sum: 0,
    },
    true,
  );
  assert.equal(out.offset_amount, 2);
  assert.equal(out.remaining_difference_sum, 0);
});

test("resultLineTotals: исключение строки тоже из снимка", () => {
  // Правило автоисключения удалили после подведения итогов: живой флаг снялся,
  // но утверждённый итог считался без этой строки.
  const totals = resultLineTotals(
    {
      difference_amount: -1,
      difference_sum: -100,
      excluded_from_totals: false,
      finalized_at: "2026-08-24T12:27:43Z",
      finalized_difference_amount: -1,
      finalized_difference_sum: -100,
      finalized_excluded_from_totals: true,
    },
    true,
  );
  assert.equal(totals.excluded, true);
  assert.equal(totals.differenceSum, -100);
});

test("resultLineTotals: без снимка — живые значения", () => {
  const totals = resultLineTotals(
    {
      difference_amount: -1,
      difference_sum: -100,
      excluded_from_totals: true,
      finalized_at: null,
      finalized_difference_sum: 0,
      finalized_excluded_from_totals: false,
    },
    true,
  );
  assert.equal(totals.excluded, true);
  assert.equal(totals.differenceSum, -100);
});

test("isInventoryResultFrozen: замок + снимок", () => {
  const finalized = {
    status: "processed",
    results_finalized_at: "2026-08-24T12:27:43Z",
    results_reopened_at: null,
    results_snapshot_at: "2026-08-24T12:27:43Z",
  };
  assert.equal(isInventoryResultFrozen(finalized), true);
  // Итоги переоткрыли — снова показываем живые значения.
  assert.equal(
    isInventoryResultFrozen({
      ...finalized,
      results_finalized_at: null,
      results_reopened_at: "2026-08-25T09:00:00Z",
    }),
    false,
  );
  // Снимок не снялся — замораживать нечего.
  assert.equal(isInventoryResultFrozen({ ...finalized, results_snapshot_at: null }), false);
});
