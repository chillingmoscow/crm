import assert from "node:assert/strict";
import test from "node:test";

import { countMissingSubmitItems, type SubmitCompletenessItem } from "./submit-completeness.ts";

const item = (id: string, patch: Partial<SubmitCompletenessItem> = {}): SubmitCompletenessItem => ({
  id,
  needsRecount: false,
  recountPreviousAmount: null,
  submittedAmount: null,
  ...patch,
});

test("первый счёт: нужны все строки, значение из запроса или сохранённое", () => {
  const items = [item("a"), item("b", { submittedAmount: 2 }), item("c")];
  assert.equal(
    countMissingSubmitItems({ status: "in_progress", items, requestAmounts: new Map([["a", 1]]) }),
    1,
  );
  assert.equal(
    countMissingSubmitItems({ status: "assigned", items, requestAmounts: new Map([["a", 1], ["c", 0]]) }),
    0,
    "ноль — тоже значение",
  );
});

test("пустые, отрицательные и нечисловые значения не считаются заполненными", () => {
  const items = [item("a"), item("b"), item("c")];
  const requestAmounts = new Map<string, number | null>([
    ["a", null],
    ["b", -1],
    ["c", Number.NaN],
  ]);
  assert.equal(countMissingSubmitItems({ status: "in_progress", items, requestAmounts }), 3);
});

test("пересчёт: нужны только отмеченные, и только из запроса", () => {
  const items = [
    item("a", { needsRecount: true, submittedAmount: 5 }),
    item("b", { needsRecount: true }),
    item("c"),
  ];
  assert.equal(
    countMissingSubmitItems({ status: "recount_pending", items, requestAmounts: new Map([["b", 1]]) }),
    1,
    "старое число отмеченной строки не засчитывается",
  );
  assert.equal(
    countMissingSubmitItems({ status: "recount_pending", items, requestAmounts: new Map([["a", 5], ["b", 1]]) }),
    0,
    "неотмеченные строки не обязательны",
  );
});

test("пересчёт без отметок (данные до миграции 228): круг — строки, бывавшие на пересчёте", () => {
  const items = [item("a", { recountPreviousAmount: 3 }), item("b", { recountPreviousAmount: 1, submittedAmount: 1 }), item("c")];
  assert.equal(countMissingSubmitItems({ status: "recount_pending", items, requestAmounts: new Map() }), 1);
});

test("пересчёт без отметок и истории — как первый счёт", () => {
  const items = [item("a"), item("b")];
  assert.equal(countMissingSubmitItems({ status: "recount_pending", items, requestAmounts: new Map([["a", 1]]) }), 1);
});
