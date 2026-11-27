import { test } from "node:test";
import assert from "node:assert/strict";

import { categoriesToLikePatterns } from "./action-categories.ts";

/** Как PostgREST/Postgres понимает шаблон like: `*` — любая строка,
 *  `_` — любой один символ. */
function matches(category: string, code: string): boolean {
  return categoriesToLikePatterns([category]).some((pattern) => {
    const re = pattern
      .split("")
      .map((ch) => (ch === "*" ? ".*" : ch === "_" ? "." : ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&")))
      .join("");
    return new RegExp(`^${re}$`).test(code);
  });
}

test("обязательное чтение: просьба перечитать и напоминание — «Создание»", () => {
  assert.ok(matches("created", "kb_page.reread_requested"));
  assert.ok(matches("created", "kb_page.reminder_sent"));
});

test("обязательное чтение: «Не нужно» — «Изменение»", () => {
  assert.ok(matches("changed", "kb_page.reread_dismissed"));
});

test("отправленные оповещения кассы и гостей — тоже «Создание»", () => {
  assert.ok(matches("created", "cash.control.alert_sent"));
  assert.ok(matches("created", "crm.guest.notification_sent"));
});
