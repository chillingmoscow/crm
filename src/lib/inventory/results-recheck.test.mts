import assert from "node:assert/strict";
import test from "node:test";

import {
  compareResultLines,
  describeResultDrift,
  hasResultDrift,
  type InventoryRecheckLine,
} from "./results-recheck.ts";

// Реальный случай СВ340: проверяющий видел итог +89,25 ₽, а к моменту
// проведения по шести позициям расчётный остаток уехал — провелось 16 301,75 ₽.
const before: InventoryRecheckLine[] = [
  { externalItemId: "63601", differenceAmount: 0, differenceSum: 0 },
  { externalItemId: "63456", differenceAmount: -0.6, differenceSum: -4650 },
  { externalItemId: "63500", differenceAmount: 0.4, differenceSum: 2900 },
];
const after: InventoryRecheckLine[] = [
  { externalItemId: "63601", differenceAmount: 0.6, differenceSum: 4350 },
  { externalItemId: "63456", differenceAmount: -0.6, differenceSum: -4650 },
  { externalItemId: "63500", differenceAmount: 0.4, differenceSum: 2900 },
];

test("расхождение по строке ловится, итог считается по обоим срезам", () => {
  const diff = compareResultLines(before, after);
  assert.equal(diff.changedLines, 1);
  assert.deepEqual(diff.changedKeys, ["63601"]);
  assert.equal(diff.beforeTotal, -1750);
  assert.equal(diff.afterTotal, 2600);
  assert.equal(hasResultDrift(diff), true);
});

test("данные не менялись → дрейфа нет", () => {
  const diff = compareResultLines(before, before.map((line) => ({ ...line })));
  assert.equal(hasResultDrift(diff), false);
  assert.equal(diff.changedLines, 0);
});

test("расхождение переехало между строками при том же итоге — это тоже дрейф", () => {
  const moved: InventoryRecheckLine[] = [
    { externalItemId: "63601", differenceAmount: -0.6, differenceSum: -4650 },
    { externalItemId: "63456", differenceAmount: 0, differenceSum: 0 },
    { externalItemId: "63500", differenceAmount: 0.4, differenceSum: 2900 },
  ];
  const diff = compareResultLines(before, moved);
  assert.equal(diff.beforeTotal, diff.afterTotal);
  assert.equal(hasResultDrift(diff), true);
  assert.equal(diff.changedLines, 2);
});

test("появление и исчезновение строк считается отдельно", () => {
  const diff = compareResultLines(before, [
    ...after.slice(0, 2),
    { externalItemId: "99999", differenceAmount: 1, differenceSum: 1000 },
  ]);
  assert.equal(diff.addedLines, 1);
  assert.equal(diff.removedLines, 1);
  assert.equal(hasResultDrift(diff), true);
});

test("копеечные хвосты не считаются дрейфом", () => {
  const jittered = before.map((line) => ({
    ...line,
    differenceSum: (line.differenceSum ?? 0) + 0.001,
  }));
  assert.equal(hasResultDrift(compareResultLines(before, jittered)), false);
});

test("null-значения не ломают сравнение", () => {
  const withNulls: InventoryRecheckLine[] = [
    { externalItemId: "63601", differenceAmount: null, differenceSum: null },
  ];
  const diff = compareResultLines(withNulls, [
    { externalItemId: "63601", differenceAmount: 0, differenceSum: 0 },
  ]);
  assert.equal(hasResultDrift(diff), false);
});

test("сообщение называет и строки, и обе суммы", () => {
  // Intl подставляет неразрывные пробелы — нормализуем перед сравнением.
  const text = describeResultDrift(compareResultLines(before, after)).replace(/\s/g, " ");
  assert.match(text, /изменилась 1 строка/);
  assert.match(text, /Итог был -1 750,00 ₽/);
  assert.match(text, /стал 2 600,00 ₽/);
  assert.match(text, /ещё раз/);
});

test("склонение строк: 1 / 3 / 6", () => {
  const line = (id: string) => ({ externalItemId: id, differenceAmount: 0, differenceSum: 0 });
  const changed = (id: string) => ({ externalItemId: id, differenceAmount: 1, differenceSum: 100 });
  const ids = ["1", "2", "3", "4", "5", "6"];
  const base = ids.map(line);
  const text = (n: number) =>
    describeResultDrift(compareResultLines(base, ids.map((id, i) => (i < n ? changed(id) : line(id))))).replace(/\s/g, " ");
  assert.match(text(1), /изменилась 1 строка/);
  assert.match(text(3), /изменились 3 строки/);
  assert.match(text(6), /изменились 6 строк/);
});
