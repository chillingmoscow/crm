import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIngredientHistory,
  frozenDocumentIds,
  summarizeIngredientHistory,
  type IngredientHistoryItem,
} from "./ingredient-history-shared.ts";

const NO_RESORTS = new Map();

function doc(over: Partial<IngredientHistoryItem["documents"] & object> = {}) {
  return {
    document_number: "ИНВ-0001",
    invoice_date: "2026-08-29T19:31:45Z",
    status: "ready_for_review",
    results_finalized_at: null,
    results_reopened_at: null,
    results_snapshot_at: null,
    ...over,
  };
}

function item(over: Partial<IngredientHistoryItem> = {}): IngredientHistoryItem {
  return {
    id: "item-1",
    document_id: "doc-1",
    actual_amount: 16.5,
    calculated_amount: 18,
    measure_unit_name: "кг",
    exclude_reason: null,
    difference_amount: -1.5,
    difference_sum: -1335,
    excluded_from_totals: false,
    documents: doc(),
    ...over,
  };
}

test("buildIngredientHistory: сданный акт отдаёт фактическую разницу", () => {
  const [entry] = buildIngredientHistory([item()], NO_RESORTS, new Set());

  assert.equal(entry.counted, true);
  assert.equal(entry.differenceAmount, -1.5);
  assert.equal(entry.differenceSum, -1335);
  assert.equal(entry.excluded, false);
  assert.equal(entry.resort, null);
  assert.equal(entry.measureUnitName, "кг");
});

test("buildIngredientHistory: у несданного акта разницы нет", () => {
  // Quick Resto отдаёт «факт − остаток» всегда, поэтому у нетронутого акта
  // разница равна минус всему складскому остатку. Показать её значило бы
  // придумать недостачу там, где никто ещё не считал.
  const [entry] = buildIngredientHistory(
    [item({ actual_amount: null, difference_amount: -18, difference_sum: -16020, documents: doc({ status: "assigned" }) })],
    NO_RESORTS,
    new Set(),
  );

  assert.equal(entry.counted, false);
  assert.equal(entry.differenceAmount, null);
  assert.equal(entry.differenceSum, null);
  // Расчётный остаток при этом законный — его и показываем.
  assert.equal(entry.calculatedAmount, 18);
});

test("buildIngredientHistory: у зафиксированного акта берётся снимок", () => {
  // Строка с прода: живые колонки уехали после переимпорта, а показать нужно то,
  // что утвердил проверяющий, — включая исключение из итогов.
  const frozen = item({
    documents: doc({ status: "processed", results_snapshot_at: "2026-08-31T08:57:05Z" }),
    difference_amount: -0.5,
    difference_sum: -445,
    excluded_from_totals: false,
    finalized_at: "2026-08-31T08:57:05Z",
    finalized_difference_amount: -0.8,
    finalized_difference_sum: -712,
    finalized_excluded_from_totals: true,
  });
  const frozenIds = frozenDocumentIds([frozen]);
  assert.deepEqual([...frozenIds], ["doc-1"]);

  const [entry] = buildIngredientHistory([frozen], NO_RESORTS, frozenIds);
  assert.equal(entry.differenceAmount, -0.8);
  assert.equal(entry.differenceSum, -712);
  assert.equal(entry.excluded, true);
});

test("frozenDocumentIds: переоткрытые итоги снова живые", () => {
  const reopened = item({
    documents: doc({
      status: "processed",
      results_snapshot_at: "2026-08-31T08:57:05Z",
      results_reopened_at: "2026-08-31T10:00:00Z",
    }),
    finalized_at: "2026-08-31T08:57:05Z",
    finalized_difference_amount: -0.8,
  });

  assert.deepEqual([...frozenDocumentIds([reopened])], []);
  const [entry] = buildIngredientHistory([reopened], NO_RESORTS, frozenDocumentIds([reopened]));
  assert.equal(entry.differenceAmount, -1.5);
});

test("buildIngredientHistory: пересорт приходит пометкой, а не подменой числа", () => {
  const resorts = new Map([
    ["item-1", { offsetAmount: 1, remainingDifferenceAmount: -0.5, remainingDifferenceSum: -445 }],
  ]);
  const [entry] = buildIngredientHistory([item()], resorts, new Set());

  assert.equal(entry.differenceAmount, -1.5);
  assert.deepEqual(entry.resort, {
    offsetAmount: 1,
    remainingDifferenceAmount: -0.5,
    remainingDifferenceSum: -445,
  });
});

test("buildIngredientHistory: свежие акты сверху, без даты — в конец", () => {
  const entries = buildIngredientHistory(
    [
      item({ id: "a", document_id: "d-a", documents: doc({ document_number: "ИНВ-0001", invoice_date: "2026-08-01T00:00:00Z" }) }),
      item({ id: "b", document_id: "d-b", documents: doc({ document_number: "ИНВ-0009", invoice_date: null }) }),
      item({ id: "c", document_id: "d-c", documents: doc({ document_number: "ИНВ-0004", invoice_date: "2026-08-30T00:00:00Z" }) }),
    ],
    NO_RESORTS,
    new Set(),
  );

  assert.deepEqual(
    entries.map((entry) => entry.documentNumber),
    ["ИНВ-0004", "ИНВ-0001", "ИНВ-0009"],
  );
});

test("summarizeIngredientHistory: раскладывает акты по знаку количества", () => {
  const summary = summarizeIngredientHistory([
    { differenceAmount: 0.6, differenceSum: 4350 },
    { differenceAmount: -1.2, differenceSum: -8700 },
    { differenceAmount: -0.4, differenceSum: -2900 },
    { differenceAmount: 0, differenceSum: 0 },
  ]);

  assert.equal(summary.countedActs, 4);
  assert.equal(summary.surplusActs, 1);
  assert.equal(summary.shortfallActs, 2);
  assert.equal(summary.evenActs, 1);
  assert.equal(summary.netSum, -7250);
  assert.equal(summary.pendingActs, 0);
});

test("summarizeIngredientHistory: акты без итогов не попадают в разбивку", () => {
  const summary = summarizeIngredientHistory([
    { differenceAmount: null, differenceSum: null },
    { differenceAmount: -1, differenceSum: -100 },
  ]);

  assert.equal(summary.pendingActs, 1);
  assert.equal(summary.countedActs, 1);
  assert.equal(summary.shortfallActs, 1);
  assert.equal(summary.netSum, -100);
});

test("summarizeIngredientHistory: количество без суммы — это всё равно плюс", () => {
  // У строки может не быть себестоимости: по деньгам ноль, по товару излишек.
  const summary = summarizeIngredientHistory([{ differenceAmount: 2, differenceSum: null }]);

  assert.equal(summary.surplusActs, 1);
  assert.equal(summary.netSum, 0);
});

test("summarizeIngredientHistory: пустая история", () => {
  assert.deepEqual(summarizeIngredientHistory([]), {
    countedActs: 0,
    pendingActs: 0,
    surplusActs: 0,
    shortfallActs: 0,
    evenActs: 0,
    netSum: 0,
  });
});
