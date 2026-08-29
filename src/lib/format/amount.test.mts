import assert from "node:assert/strict";
import test from "node:test";

import { formatQuantityAmount, signedAmountClass } from "./amount.ts";

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

test("signedAmountClass: одна палитра на списки актов, итоги и финансы", () => {
  // Семантическая пара income/expense из дизайн-системы. Пин на точные классы,
  // а не на /green/: список актов раньше красил излишек в emerald, итоги — в
  // green, и один и тот же «плюс» был двух разных зелёных на соседних экранах.
  assert.equal(signedAmountClass(1), "text-green-700 dark:text-green-400");
  assert.equal(signedAmountClass(-1), "text-red-700 dark:text-red-400");
  assert.equal(signedAmountClass(0), "text-muted-foreground");
  assert.equal(signedAmountClass(null), "text-muted-foreground");
  assert.equal(signedAmountClass(undefined), "text-muted-foreground");
});
