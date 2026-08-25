import assert from "node:assert/strict";
import test from "node:test";

import { resolveSubmittedAmount } from "./sync-amounts.ts";

test("значение передали в текущем вызове → пишем его", () => {
  const submittedAmounts = new Map<string, number | null>([["item-1", 1.75]]);
  assert.equal(resolveSubmittedAmount({ externalItemId: "item-1", submittedAmounts, existingAmount: 0.5 }), 1.75);
});

test("явный сброс в null уважаем", () => {
  const submittedAmounts = new Map<string, number | null>([["item-1", null]]);
  assert.equal(resolveSubmittedAmount({ externalItemId: "item-1", submittedAmounts, existingAmount: 0.5 }), null);
});

test("строки нет в вызове → сохраняем уже введённое (импорт из QR не стирает)", () => {
  const submittedAmounts = new Map<string, number | null>([["item-2", 3]]);
  assert.equal(resolveSubmittedAmount({ externalItemId: "item-1", submittedAmounts, existingAmount: 0.5 }), 0.5);
});

test("карты вообще нет → сохраняем уже введённое", () => {
  assert.equal(resolveSubmittedAmount({ externalItemId: "item-1", existingAmount: 0.5 }), 0.5);
});

test("ничего не введено → null", () => {
  assert.equal(resolveSubmittedAmount({ externalItemId: "item-1" }), null);
  assert.equal(resolveSubmittedAmount({ externalItemId: "item-1", existingAmount: null }), null);
});

test("ноль — валидное введённое значение, не путаем с «не введено»", () => {
  assert.equal(resolveSubmittedAmount({ externalItemId: "item-1", existingAmount: 0 }), 0);
  const submittedAmounts = new Map<string, number | null>([["item-1", 0]]);
  assert.equal(resolveSubmittedAmount({ externalItemId: "item-1", submittedAmounts, existingAmount: 5 }), 0);
});
