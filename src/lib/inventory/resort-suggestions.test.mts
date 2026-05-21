import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHistorySuggestions,
  clampConfidence,
  resortSuggestionKey,
  type HistoryResortItemRow,
  type HistoryResortRow,
  type SuggestionSourceItem,
} from "./resort-suggestions.ts";

const historyResorts: HistoryResortRow[] = [
  { id: "r1", document_id: "doc-old", reason: "кола/зеро", created_at: "2026-01-01T00:00:00Z" },
];
const historyItems: HistoryResortItemRow[] = [
  { resort_id: "r1", ingredient_id: "ing-cola", document_item_id: "old-1", role: "shortage", product_name: "Кола" },
  { resort_id: "r1", ingredient_id: "ing-zero", document_item_id: "old-2", role: "surplus", product_name: "Зеро" },
];
const currentItems: SuggestionSourceItem[] = [
  { id: "cur-cola", ingredient_id: "ing-cola", product_name: "Кола", difference_amount: -5, excluded_from_totals: false },
  { id: "cur-zero", ingredient_id: "ing-zero", product_name: "Зеро", difference_amount: 3, excluded_from_totals: false },
];

test("history: повторяющаяся пара недостача+излишек → подсказка", () => {
  const out = buildHistorySuggestions({ currentItems, activeResortItemIds: new Set(), historyResorts, historyItems });
  assert.equal(out.length, 1);
  assert.deepEqual([...out[0].itemIds].sort(), ["cur-cola", "cur-zero"]);
  assert.equal(out[0].source, "history");
  assert.match(out[0].reason, /Похожий пересорт/);
});

test("history: исключённые / в активном пересорте / нулевые — пропускаются", () => {
  // cola уже в активном пересорте → пара распадается
  assert.equal(
    buildHistorySuggestions({ currentItems, activeResortItemIds: new Set(["cur-cola"]), historyResorts, historyItems }).length,
    0,
  );
  // zero исключён из итогов
  const excluded: SuggestionSourceItem[] = [currentItems[0], { ...currentItems[1], excluded_from_totals: true }];
  assert.equal(
    buildHistorySuggestions({ currentItems: excluded, activeResortItemIds: new Set(), historyResorts, historyItems }).length,
    0,
  );
  // zero без расхождения
  const zero: SuggestionSourceItem[] = [currentItems[0], { ...currentItems[1], difference_amount: 0 }];
  assert.equal(
    buildHistorySuggestions({ currentItems: zero, activeResortItemIds: new Set(), historyResorts, historyItems }).length,
    0,
  );
});

test("history: присутствует только одна позиция пары → нет подсказки", () => {
  assert.equal(
    buildHistorySuggestions({ currentItems: [currentItems[0]], activeResortItemIds: new Set(), historyResorts, historyItems }).length,
    0,
  );
});

test("history: обе позиции одного знака (нет пары недостача+излишек) → нет подсказки", () => {
  const bothSurplus: SuggestionSourceItem[] = [{ ...currentItems[0], difference_amount: 2 }, currentItems[1]];
  assert.equal(
    buildHistorySuggestions({ currentItems: bothSurplus, activeResortItemIds: new Set(), historyResorts, historyItems }).length,
    0,
  );
});

test("resortSuggestionKey: порядок не важен, дубликаты схлопываются", () => {
  assert.equal(resortSuggestionKey(["b", "a", "a"]), "a:b");
});

test("clampConfidence: клампит в [0.1, 0.95], нечисло → fallback", () => {
  assert.equal(clampConfidence(2, 0.5), 0.95);
  assert.equal(clampConfidence(0, 0.5), 0.1);
  assert.equal(clampConfidence("x", 0.42), 0.42);
});
