import test from "node:test";
import assert from "node:assert/strict";
import { planWrite } from "./plan.ts";

test("план оборота стёрт, план алкоголя есть — строка остаётся", () =>
  assert.equal(planWrite({ turnover: 5_000_000, alcohol: 400000 }, { turnover: null, alcohol: 400000 }), "update"));
test("оба плана стёрты — строка удаляется", () =>
  assert.equal(planWrite({ turnover: 5_000_000, alcohol: null }, { turnover: null, alcohol: null }), "delete"));
test("без изменений — ничего", () =>
  assert.equal(planWrite({ turnover: 5_000_000, alcohol: null }, { turnover: 5_000_000, alcohol: null }), "noop"));
test("строки не было — вставка, пустой ввод — ничего", () => {
  assert.equal(planWrite(null, { turnover: null, alcohol: 400000 }), "insert");
  assert.equal(planWrite(null, { turnover: null, alcohol: null }), "noop");
});
