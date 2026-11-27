import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTelegramId, telegramIdError, TELEGRAM_ID_REQUIRED } from "./telegram-id.ts";

test("Telegram ID обязателен только при приглашении в чаты", () => {
  assert.equal(telegramIdError("", true), TELEGRAM_ID_REQUIRED);
  assert.equal(telegramIdError("  ", true), TELEGRAM_ID_REQUIRED);
  assert.equal(telegramIdError("", false), null);
  assert.equal(telegramIdError(null, false), null);
});

test("Telegram ID — только цифры", () => {
  assert.equal(telegramIdError("123456789", true), null);
  assert.equal(telegramIdError(" 123 ", false), null);
  assert.match(telegramIdError("@user", false) ?? "", /только цифры/);
  assert.match(telegramIdError("1234567890123456", false) ?? "", /только цифры/);
  assert.equal(normalizeTelegramId(" 42 "), "42");
  assert.equal(normalizeTelegramId(""), null);
});
