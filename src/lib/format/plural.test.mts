import assert from "node:assert/strict";
import test from "node:test";

import { pluralRu } from "./plural.ts";

const f = (n: number) => pluralRu(n, "строка", "строки", "строк");

test("pluralRu: one (1, 21, 31)", () => {
  for (const n of [1, 21, 31, 101]) assert.equal(f(n), "строка");
});

test("pluralRu: few (2–4, 22–24)", () => {
  for (const n of [2, 3, 4, 22, 23, 24, 103]) assert.equal(f(n), "строки");
});

test("pluralRu: many (0, 5–20, 25)", () => {
  for (const n of [0, 5, 9, 10, 11, 12, 13, 14, 15, 20, 25, 100, 111]) assert.equal(f(n), "строк");
});
