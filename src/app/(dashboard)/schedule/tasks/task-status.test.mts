import { test } from "node:test";
import assert from "node:assert/strict";
import { taskMissing, taskStatus } from "./task-status.ts";

const base = {
  enabled: false,
  template_id: "t",
  recurrence: { unit: "week" as const, interval: 1, anchor: "2026-11-28" },
  items: [],
};

test("без приёмки чек-лист не нужен: задача готова к включению", () => {
  const task = { ...base, review_mode: "auto" as const };
  assert.deepEqual(taskMissing(task), []);
  assert.equal(taskStatus(task), "Черновик");
});

test("с приёмкой без пунктов — не хватает чек-листа", () => {
  const task = { ...base, review_mode: "manager" as const };
  assert.deepEqual(taskMissing(task), ["пунктов чек-листа"]);
  assert.equal(taskStatus(task), "Не настроена");
});

test("пункты-подсказки не считаются чек-листом", () => {
  const task = {
    ...base,
    review_mode: "manager" as const,
    items: [{ id: "1", kind: "info" }] as never,
  };
  assert.deepEqual(taskMissing(task), ["пунктов чек-листа"]);
});

test("включённая задача работает", () => {
  assert.equal(taskStatus({ ...base, review_mode: "auto", enabled: true }), "Работает");
});
