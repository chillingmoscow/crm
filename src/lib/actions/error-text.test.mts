import { test } from "node:test";
import assert from "node:assert/strict";
import { errorText } from "./error-text.ts";

test("errorText: ошибка базы с русским текстом проходит как есть", () => {
  assert.equal(errorText({ message: "Смена уже закрыта", code: "P0001" }, "запас"), "Смена уже закрыта");
});

test("errorText: английский текст базы и пустая ошибка заменяются запасным", () => {
  assert.equal(errorText({ message: "permission denied for table x" }, "Не удалось"), "Не удалось");
  assert.equal(errorText(new Error("duplicate key value"), "Не удалось"), "Не удалось");
  assert.equal(errorText(null, "Не удалось"), "Не удалось");
  assert.equal(errorText({ code: "23505" }, "Не удалось"), "Не удалось");
});
