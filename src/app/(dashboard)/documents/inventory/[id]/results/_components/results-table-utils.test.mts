import assert from "node:assert/strict";
import test from "node:test";

import {
  QR_CALCULATED_COLUMNS,
  columnToResultFieldFor,
  combineResultSort,
  hasDifference,
  isOpenDifference,
  resultBalancePercents,
  resultBalanceShares,
  resultFactAmount,
  resultSortFieldsFor,
  resultSortToDirection,
  resultSortToField,
  resultSortsToSorting,
  sortingToResultSorts,
  topResultDifferences,
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

test("resultSortsToSorting / sortingToResultSorts — round-trip и порядок", () => {
  const sorts: ResultSortMode[] = ["sum_desc", "empty_first", "name_asc"];
  const sorting = resultSortsToSorting(sorts);
  assert.deepEqual(sorting, [
    { id: "sum", desc: true },
    { id: "empty", desc: false },
    { id: "name", desc: false },
  ]);
  assert.deepEqual(sortingToResultSorts(sorting), sorts);
  for (const mode of ALL_MODES) {
    assert.deepEqual(sortingToResultSorts(resultSortsToSorting([mode])), [mode]);
  }
});

test("sortingToResultSorts отбрасывает неизвестные поля и повторы", () => {
  assert.deepEqual(
    sortingToResultSorts([
      { id: "group", desc: true },
      { id: "unknown", desc: false },
      { id: "group", desc: false },
      { id: "empty", desc: true },
    ]),
    ["group_desc", "empty_last"],
  );
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

test("resultFactAmount: с расчётом — факт Quick Resto, без расчёта — введённое исполнителем", () => {
  assert.equal(resultFactAmount({ actual_amount: 3, submitted_amount: 5 }, true), 3);
  assert.equal(resultFactAmount({ actual_amount: null, submitted_amount: 5 }, true), null);
  assert.equal(resultFactAmount({ actual_amount: 3, submitted_amount: 5 }, false), 5);
  assert.equal(resultFactAmount({ actual_amount: 3, submitted_amount: null }, false), 3);
  assert.equal(resultFactAmount({ actual_amount: null }, false), null);
});

test("без расчёта по строкам сортировки по сумме нет", () => {
  assert.deepEqual(resultSortFieldsFor(true), ["name", "group", "empty", "sum"]);
  assert.deepEqual(resultSortFieldsFor(false), ["name", "group", "empty"]);
  assert.equal(columnToResultFieldFor(true).management, "sum");
  assert.equal(columnToResultFieldFor(false).management, undefined);
  assert.equal(columnToResultFieldFor(false).fact, "empty");
});

test("QR_CALCULATED_COLUMNS — ровно колонки расчёта Quick Resto", () => {
  assert.deepEqual([...QR_CALCULATED_COLUMNS].sort(), ["calculated", "difference", "management"]);
});

test("topResultDifferences: по модулю суммы, без нулевых, не больше лимита", () => {
  const entry = (id: string, sum: number) => ({ id, name: id, sum, amount: null, unit: null });
  const top = topResultDifferences(
    [entry("a", -100), entry("b", 300), entry("c", 0), entry("d", -250), entry("e", 10), entry("f", 0.001), entry("g", 50), entry("h", 20)],
    5,
  );
  assert.deepEqual(top.map((item) => item.id), ["b", "d", "a", "g", "h"]);
});

test("topResultDifferences: при равной сумме — по названию", () => {
  const top = topResultDifferences([
    { id: "2", name: "Яблоко", sum: -50, amount: null, unit: null },
    { id: "1", name: "Апельсин", sum: 50, amount: null, unit: null },
  ]);
  assert.deepEqual(top.map((item) => item.id), ["1", "2"]);
});

test("resultBalanceShares: доли на одной оси и пустой случай", () => {
  assert.deepEqual(resultBalanceShares(-300, 100), { shortfall: 0.75, surplus: 0.25 });
  assert.deepEqual(resultBalanceShares(0, 40), { shortfall: 0, surplus: 1 });
  assert.equal(resultBalanceShares(0, 0), null);
});

test("resultBalancePercents: в сумме 100%, крошечная доля — «<1%»", () => {
  assert.deepEqual(resultBalancePercents({ shortfall: 0.506, surplus: 0.494 }), { shortfall: "51%", surplus: "49%" });
  assert.deepEqual(resultBalancePercents({ shortfall: 0.004, surplus: 0.996 }), { shortfall: "<1%", surplus: ">99%" });
  assert.deepEqual(resultBalancePercents({ shortfall: 0.997, surplus: 0.003 }), { shortfall: ">99%", surplus: "<1%" });
  assert.deepEqual(resultBalancePercents({ shortfall: 1, surplus: 0 }), { shortfall: "100%", surplus: "0%" });
});
