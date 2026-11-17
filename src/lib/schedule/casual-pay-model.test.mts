import test from "node:test";
import assert from "node:assert/strict";

import { casualPayModel } from "./casual-pay-model.ts";

const models = [
  { id: "waiter-bar", role_name: "Бармен" },
  { id: "senior-bar", role_name: "Бармен" },
  { id: "barback", role_name: "Барбек" },
];

test("своя модель сотрудника, если она этой должности", () => {
  assert.equal(casualPayModel({ employeeModelId: "senior-bar", roleName: "Бармен", models }).id, "senior-bar");
});

test("единственная модель должности, если своя — другой должности", () => {
  assert.equal(casualPayModel({ employeeModelId: "waiter-bar", roleName: "Барбек", models }).id, "barback");
});

test("несколько моделей и ни одна не своя — выбрать нельзя", () => {
  const r = casualPayModel({ employeeModelId: "barback", roleName: "Бармен", models });
  assert.equal(r.id, null);
  assert.equal(r.options.length, 2);
});

test("без должности смены модели нет", () => {
  assert.deepEqual(casualPayModel({ employeeModelId: "waiter-bar", roleName: null, models }), { id: null, options: [] });
});
