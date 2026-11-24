import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { actionErrorMessage, actionResult, unwrapAction } from "./result.ts";

test("русский текст ошибки проходит как есть", async () => {
  const result = await actionResult(async () => {
    throw new Error("Сначала оформите обратную бонусную операцию");
  });
  assert.deepEqual(result, { ok: false, error: "Сначала оформите обратную бонусную операцию" });
  assert.throws(() => unwrapAction(result), /обратную бонусную/);
});

test("английский технический текст заменяется русским", () => {
  assert.equal(actionErrorMessage(new Error("permission denied for table x"), "Не удалось удалить"), "Не удалось удалить");
  assert.equal(actionErrorMessage("oops", "Не удалось"), "Не удалось");
});

test("ошибка проверки zod — русским текстом", () => {
  const plain = z.object({ id: z.string().uuid() }).safeParse({ id: "x" });
  assert.equal(actionErrorMessage(plain.error, "Не удалось"), "Проверьте введённые данные");
  const own = z.string().min(3, "Укажите причину").safeParse("");
  assert.equal(actionErrorMessage(own.error, "Не удалось"), "Укажите причину");
});

test("успешный результат отдаёт данные", async () => {
  assert.equal(unwrapAction(await actionResult(async () => 42)), 42);
});
