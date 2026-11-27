import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTableWidths, serializeTableWidths, tableWidthKey, tableWidthRoute } from "./table-width-pref.ts";

test("ключ таблицы зависит от адреса и столбцов и стабилен", () => {
  const a = tableWidthKey("/finance/accounts", ["name", "balance"]);
  assert.equal(a, tableWidthKey("/finance/accounts", ["name", "balance"]));
  assert.notEqual(a, tableWidthKey("/finance/accounts", ["name"]));
  assert.notEqual(a, tableWidthKey("/finance/categories", ["name", "balance"]));
  assert.match(a, /^[0-9a-z]{1,8}$/);
});

test("ширины переживают запись и чтение, мусор отбрасывается", () => {
  const value = serializeTableWidths(new Map([["abc", 900]]), "def", 1120.6);
  assert.equal(value, "abc:900.def:1121");
  assert.deepEqual([...parseTableWidths(value)], [["abc", 900], ["def", 1121]]);
  assert.deepEqual([...parseTableWidths("x:-1.Y!:5.ok:12000.fine:640")], [["fine", 640]]);
  assert.equal(parseTableWidths(undefined).size, 0);
});

test("повторная запись переносит ключ в конец, старые лишние уходят", () => {
  let map = new Map<string, number>();
  for (let i = 0; i < 30; i++) map = parseTableWidths(serializeTableWidths(map, `k${i}`, 100 + i));
  assert.equal(map.size, 24);
  assert.equal(map.has("k0"), false);
  const moved = parseTableWidths(serializeTableWidths(map, "k10", 500));
  assert.deepEqual([...moved].at(-1), ["k10", 500]);
});

test("карточки с разными id делят одну запись", () => {
  assert.equal(
    tableWidthRoute("/people/staff/0f8fad5b-d9cb-469f-a165-70867728950e/documents"),
    "/people/staff/:id/documents",
  );
  assert.equal(tableWidthRoute("/documents/inventory/1234/results"), "/documents/inventory/:id/results");
  assert.equal(
    tableWidthKey("/finance/accounts/0f8fad5b-d9cb-469f-a165-70867728950e", ["a"]),
    tableWidthKey("/finance/accounts/7c9e6679-7425-40de-944b-e07fc1f90ae7", ["a"]),
  );
});
