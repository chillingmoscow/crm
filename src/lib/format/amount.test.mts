import assert from "node:assert/strict";
import test from "node:test";

import { formatQuantityAmount } from "./amount.ts";

test("formatQuantityAmount: целые без дробной части (штуки)", () => {
  assert.equal(formatQuantityAmount(93, 1), "93");
  assert.equal(formatQuantityAmount(314, 1), "314");
  assert.equal(formatQuantityAmount(0, 1), "0");
  // даже когда unit дробный, целое значение показываем без «,0»
  assert.equal(formatQuantityAmount(14, 1), "14");
});

test("formatQuantityAmount: дробные до scale знаков (литры)", () => {
  assert.equal(formatQuantityAmount(13.5, 1), "13,5");
  // округление до scale
  assert.equal(formatQuantityAmount(13.45, 1), "13,5");
});

test("formatQuantityAmount: scale 0 округляет до целых", () => {
  assert.equal(formatQuantityAmount(13.5, 0), "14");
  assert.equal(formatQuantityAmount(13.4, 0), "13");
});

test("formatQuantityAmount: scale 2 сохраняет сотые, но без хвостовых нулей", () => {
  assert.equal(formatQuantityAmount(13.05, 2), "13,05");
  assert.equal(formatQuantityAmount(13.5, 2), "13,5");
  assert.equal(formatQuantityAmount(13, 2), "13");
});

test("formatQuantityAmount: невалидные значения → тире", () => {
  assert.equal(formatQuantityAmount(null, 1), "—");
  assert.equal(formatQuantityAmount(undefined, 1), "—");
  assert.equal(formatQuantityAmount(Number.NaN, 1), "—");
});
