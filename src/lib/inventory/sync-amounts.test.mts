import assert from "node:assert/strict";
import test from "node:test";

import { resolveLineResult, resolveSubmittedAmount } from "./sync-amounts.ts";

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

const EMPTY_INCOMING = {
  hasResult: false,
  calculatedAmount: null,
  differenceAmount: null,
  primeCost: null,
  differenceSum: null,
};

test("QR прислал расчёты → пишем их", () => {
  const out = resolveLineResult({
    incoming: { hasResult: true, calculatedAmount: 1.5, differenceAmount: 0.25, primeCost: 6760, differenceSum: 1690 },
    existing: { calculatedAmount: 9, differenceAmount: 9, primeCost: 9, differenceSum: 9 },
  });
  assert.equal(out.preserved, false);
  assert.equal(out.values.calculatedAmount, 1.5);
  assert.equal(out.values.differenceSum, 1690);
});

test("backoffice не ответил → сохраняем уже посчитанные итоги, а не стираем их", () => {
  const out = resolveLineResult({
    incoming: EMPTY_INCOMING,
    existing: { calculatedAmount: 1.5, differenceAmount: 0.25, primeCost: 6760, differenceSum: 1690 },
  });
  assert.equal(out.preserved, true);
  assert.equal(out.values.calculatedAmount, 1.5);
  assert.equal(out.values.differenceAmount, 0.25);
  assert.equal(out.values.differenceSum, 1690);
});

test("нового нет и старого нет → остаётся пусто", () => {
  const out = resolveLineResult({ incoming: EMPTY_INCOMING, existing: null });
  assert.equal(out.preserved, false);
  assert.equal(out.values.calculatedAmount, null);
});

test("нулевая разница — это значение, а не «пусто»", () => {
  const out = resolveLineResult({
    incoming: EMPTY_INCOMING,
    existing: { calculatedAmount: 0.2, differenceAmount: 0, primeCost: 7250, differenceSum: 0 },
  });
  assert.equal(out.preserved, true);
  assert.equal(out.values.differenceAmount, 0);
  assert.equal(out.values.calculatedAmount, 0.2);
});

test("строка, по которой QR никогда не давал расчётов, не выдумывает значения", () => {
  const out = resolveLineResult({ incoming: EMPTY_INCOMING, existing: { calculatedAmount: null, differenceAmount: null } });
  assert.equal(out.preserved, false);
  assert.equal(out.values.differenceSum, null);
});
