import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_TWO_DIGITS,
  PASSWORD_TWO_LETTERS,
  passwordStrength,
} from "./password.ts";
import { isRateLimited } from "./auth-errors.ts";

const REGISTER = [PASSWORD_MIN_LENGTH, PASSWORD_TWO_DIGITS];
const NEW_PASSWORD = [PASSWORD_MIN_LENGTH, PASSWORD_TWO_LETTERS];

test("пока правило не выполнено, пароль не выше «Слабый»", () => {
  const r = passwordStrength("Abcdefgh!xyz1", REGISTER);
  assert.equal(r.level, 1);
  assert.equal(r.unmet, PASSWORD_TWO_DIGITS);

  const n = passwordStrength("12345678!", NEW_PASSWORD);
  assert.equal(n.level, 1);
  assert.equal(n.unmet, PASSWORD_TWO_LETTERS);

  assert.equal(passwordStrength("ab1", REGISTER).unmet, PASSWORD_MIN_LENGTH);
});

test("выполненные правила — оценка по разнообразию", () => {
  assert.deepEqual(passwordStrength("Abcdefgh!xyz12", REGISTER), { level: 4, unmet: null });
  assert.deepEqual(passwordStrength("abcdef12", REGISTER), { level: 2, unmet: null });
  assert.deepEqual(passwordStrength("", REGISTER), { level: null, unmet: null });
});

test("лимит попыток GoTrue узнаём по статусу, коду и тексту", () => {
  assert.equal(isRateLimited({ status: 429 }), true);
  assert.equal(isRateLimited({ code: "over_email_send_rate_limit" }), true);
  assert.equal(
    isRateLimited({ message: "For security purposes, you can only request this after 42 seconds." }),
    true,
  );
  assert.equal(isRateLimited({ status: 400, message: "Invalid login credentials" }), false);
  assert.equal(isRateLimited(null), false);
});
