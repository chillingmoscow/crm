import { test } from "node:test";
import assert from "node:assert/strict";
import { sheetTotal, totalDelta } from "./deduction-totals.ts";

test("пустая вставка (например, одна строка заголовка) - итог неизвестен, а не 0", () => {
  assert.deepEqual(sheetTotal([], 0), { total: null, incomplete: false });
});

test("пустая вставка при нечитаемых строках - итог неизвестен и помечен неполным", () => {
  assert.deepEqual(sheetTotal([], 3), { total: null, incomplete: true });
});

test("сумма считается в копейках без хвостов float", () => {
  assert.deepEqual(sheetTotal([{ amount: 0.1 }, { amount: 0.2 }], 0), { total: 0.3, incomplete: false });
});

test("хоть одна неизвестная сумма делает итог неизвестным и неполным", () => {
  assert.deepEqual(sheetTotal([{ amount: 100 }, { amount: null }], 0), { total: null, incomplete: true });
});

test("нечитаемые строки: итог известных строк остаётся, но помечен неполным", () => {
  assert.deepEqual(sheetTotal([{ amount: 100 }], 2), { total: 100, incomplete: true });
});

test("настоящий ноль - это ноль, а не неизвестное", () => {
  assert.deepEqual(sheetTotal([{ amount: 0 }], 0), { total: 0, incomplete: false });
});

test("разница: неизвестная сторона даёт неизвестную разницу, а не всю сумму другой стороны", () => {
  assert.equal(totalDelta(1700, null), null);
  assert.equal(totalDelta(null, 1700), null);
  assert.equal(totalDelta(null, null), null);
});

test("разница в копейках, знак - основание минус таблица", () => {
  assert.equal(totalDelta(1700, 1699.9), 0.1);
  assert.equal(totalDelta(100, 150.25), -50.25);
  assert.equal(totalDelta(300, 300), 0);
});
