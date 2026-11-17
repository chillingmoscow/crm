import { test } from "node:test";
import assert from "node:assert/strict";
import { casualRoleIds, splitCasualName } from "./casual-name.ts";

test("saved Quick Resto name parts win over the display name", () => {
  assert.deepEqual(splitCasualName("Кристина", { first_name: "Кристина", last_name: "Мелконян" }), { firstName: "Кристина", lastName: "Мелконян" });
});
test("the first word is the first name, the rest is the last name", () => {
  assert.deepEqual(splitCasualName("  Полина  Анна Иванова "), { firstName: "Полина", lastName: "Анна Иванова" });
  assert.deepEqual(splitCasualName("Полина"), { firstName: "Полина", lastName: "" });
});
test("only default shift-pay roles linked to Quick Resto are offered", () => {
  const base = { is_role_default: true, archived: false, monthly_amount: 0, quickresto_role_id: null };
  const ids = casualRoleIds([
    { ...base, role_id: "host", quickresto_role_id: 5 },
    { ...base, role_id: "waiter" },
    { ...base, role_id: "linked" },
    { ...base, role_id: "manager", quickresto_role_id: 6, monthly_amount: 90000 },
    { ...base, role_id: "old", quickresto_role_id: 7, archived: true },
    { ...base, role_id: "extra", quickresto_role_id: 8, is_role_default: false },
  ], ["linked"]);
  assert.deepEqual([...ids].sort(), ["host", "linked"]);
});
