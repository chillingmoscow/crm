import { test } from "node:test";
import assert from "node:assert/strict";
import { candidatesViewCookieName, candidatesViewKey, parseCandidatesView } from "./view-pref.ts";

test("cookie вида списка — допустимое имя по ключу localStorage", () => {
  const key = "11111111-2222-3333-4444-555555555555:aaaa";
  assert.equal(candidatesViewKey(key), `candidates.view.${key}`);
  assert.match(candidatesViewCookieName(key), /^sheerly_view_[a-zA-Z0-9_]+$/);
});

test("вид читается только из известных значений", () => {
  assert.equal(parseCandidatesView("board"), "board");
  assert.equal(parseCandidatesView("table"), "table");
  assert.equal(parseCandidatesView("grid"), undefined);
  assert.equal(parseCandidatesView(null), undefined);
});
