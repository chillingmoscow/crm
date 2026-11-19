import { test } from "node:test";
import assert from "node:assert/strict";
import {
  genderFormField,
  genderFormValue,
  genderSchema,
  isGender,
} from "./gender.ts";

test("принимает только male и female", () => {
  assert.equal(isGender("male"), true);
  assert.equal(isGender("female"), true);
  for (const value of ["", null, undefined, "other", "MALE"]) {
    assert.equal(isGender(value), false);
  }
});

test("серверная схема отклоняет пустую строку и null с понятной ошибкой", () => {
  assert.equal(genderSchema.safeParse("female").success, true);
  for (const value of ["", null, undefined, "other"]) {
    const parsed = genderSchema.safeParse(value);
    assert.equal(parsed.success, false);
    if (!parsed.success) assert.equal(parsed.error.issues[0]?.message, "Укажите пол");
  }
});

test("поле формы: пустая строка — ошибка «Укажите пол»", () => {
  const parsed = genderFormField.safeParse("");
  assert.equal(parsed.success, false);
  if (!parsed.success) assert.equal(parsed.error.issues[0]?.message, "Укажите пол");
  assert.equal(genderFormField.safeParse("male").success, true);
});

test("значение для формы из профиля", () => {
  assert.equal(genderFormValue("male"), "male");
  assert.equal(genderFormValue(null), "");
  assert.equal(genderFormValue("other"), "");
});
