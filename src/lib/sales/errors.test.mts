import { test } from "node:test";
import assert from "node:assert/strict";
import { salesErrorText } from "./errors.ts";

test("русские сообщения показываются как есть", () => {
  assert.equal(salesErrorText("Quick Resto не ответил вовремя"), "Quick Resto не ответил вовремя");
});

test("английские и технические заменяются общей фразой", () => {
  const out = salesErrorText("Quick Resto back-office request timed out after 20s");
  assert.match(out!, /^Не удалось получить данные/);
  assert.match(salesErrorText("fetch failed")!, /^Не удалось/);
  assert.match(salesErrorText('duplicate key value violates unique constraint "x"')!, /^Не удалось/);
});

test("пустое значение — без ошибки", () => {
  assert.equal(salesErrorText(null), null);
  assert.equal(salesErrorText("  "), null);
});
