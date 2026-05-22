import assert from "node:assert/strict";
import test from "node:test";

import {
  combineResultSort,
  differenceClass,
  hasDifference,
  isOpenDifference,
  resultSortToDirection,
  resultSortToField,
  type ResultSortMode,
} from "./results-table-utils.ts";

const ALL_MODES: ResultSortMode[] = [
  "name_asc", "name_desc",
  "group_asc", "group_desc",
  "empty_first", "empty_last",
  "sum_asc", "sum_desc",
];

test("resultSortToField маппит режим на поле", () => {
  assert.equal(resultSortToField("name_asc"), "name");
  assert.equal(resultSortToField("group_desc"), "group");
  assert.equal(resultSortToField("empty_first"), "empty");
  assert.equal(resultSortToField("empty_last"), "empty");
  assert.equal(resultSortToField("sum_asc"), "sum");
});

test("resultSortToDirection (empty_first/last — особые)", () => {
  assert.equal(resultSortToDirection("empty_first"), "asc");
  assert.equal(resultSortToDirection("empty_last"), "desc");
  assert.equal(resultSortToDirection("name_asc"), "asc");
  assert.equal(resultSortToDirection("sum_desc"), "desc");
});

test("combineResultSort round-trip по всем режимам", () => {
  for (const mode of ALL_MODES) {
    assert.equal(combineResultSort(resultSortToField(mode), resultSortToDirection(mode)), mode);
  }
});

test("hasDifference: ненулевая разница → true", () => {
  assert.equal(hasDifference({ difference_amount: -1, difference_sum: 0 }), true);
  assert.equal(hasDifference({ difference_amount: 0, difference_sum: 5 }), true);
  assert.equal(hasDifference({ difference_amount: 0, difference_sum: 0 }), false);
  assert.equal(hasDifference({ difference_amount: null, difference_sum: null }), false);
});

test("isOpenDifference: исключённые и полностью покрытые пересортом — не открытые", () => {
  // исключённая строка
  assert.equal(
    isOpenDifference({ difference_amount: -5, difference_sum: -500, excluded_from_totals: true }, undefined),
    false,
  );
  // пересорт покрыл полностью (остаток 0)
  assert.equal(
    isOpenDifference(
      { difference_amount: -5, difference_sum: -500 },
      { remainingDifferenceAmount: 0, remainingDifferenceSum: 0 },
    ),
    false,
  );
  // пересорт с остатком → открытое
  assert.equal(
    isOpenDifference(
      { difference_amount: -5, difference_sum: -500 },
      { remainingDifferenceAmount: -2, remainingDifferenceSum: -200 },
    ),
    true,
  );
  // без пересорта, есть разница → открытое
  assert.equal(isOpenDifference({ difference_amount: -5, difference_sum: -500 }, undefined), true);
  // без разницы → не открытое
  assert.equal(isOpenDifference({ difference_amount: 0, difference_sum: 0 }, undefined), false);
});

test("differenceClass по знаку", () => {
  assert.match(differenceClass(-1), /red/);
  assert.match(differenceClass(1), /green/);
  assert.equal(differenceClass(0), "text-muted-foreground");
  assert.equal(differenceClass(null), "text-muted-foreground");
});
