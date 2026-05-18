import test from "node:test";
import assert from "node:assert/strict";

import { parseCsv } from "./csv.ts";

test("simple rows", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,2,3"), [
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
});

test("quoted field with comma and newline", () => {
  assert.deepEqual(
    parseCsv('Name,Note\n"Граф Толстой","строка1\nстрока2, и ещё"'),
    [
      ["Name", "Note"],
      ["Граф Толстой", "строка1\nстрока2, и ещё"],
    ],
  );
});

test("escaped quotes", () => {
  assert.deepEqual(parseCsv('a\n"He said ""hi"""'), [["a"], ['He said "hi"']]);
});

test("CRLF + trailing newline → no extra empty row", () => {
  assert.deepEqual(parseCsv("a,b\r\n1,2\r\n"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("BOM stripped", () => {
  assert.deepEqual(parseCsv("﻿a,b\n1,2"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("empty input → []", () => {
  assert.deepEqual(parseCsv(""), []);
});

test("empty trailing field preserved", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,,3"), [
    ["a", "b", "c"],
    ["1", "", "3"],
  ]);
});
