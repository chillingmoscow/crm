import assert from "node:assert/strict";
import test from "node:test";

import { storeDepartmentBindingPatch } from "./store-department-binding.ts";

test("синхронизация не трогает привязку существующего склада", () => {
  const patch = storeDepartmentBindingPatch({ storeExists: true });
  assert.deepEqual(patch, {});
  assert.equal("department_scope" in patch, false, "колонка не должна попасть в DO UPDATE SET");
  assert.equal("department_id" in patch, false, "колонка не должна попасть в DO UPDATE SET");
});

test("новый склад приезжает без подразделения", () => {
  const patch = storeDepartmentBindingPatch({ storeExists: false });
  assert.deepEqual(patch, { department_scope: "unset", department_id: null });
});

test("ручное «Общий склад» и «Подразделение» переживают синхронизацию", () => {
  // Человек выбрал привязку в /org/stores. Payload существующего склада
  // не должен содержать ни одного ключа привязки, иначе апсерт её затрёт.
  const patch = storeDepartmentBindingPatch({ storeExists: true });
  const payload = { account_id: "acc", external_id: "42", title: "Кальяны Зал", ...patch };
  assert.deepEqual(payload, { account_id: "acc", external_id: "42", title: "Кальяны Зал" });
});

test("спред патча нового склада держит оба ключа согласованными", () => {
  // CHECK в базе: scope = 'department' тогда и только тогда, когда department_id задан.
  const patch = storeDepartmentBindingPatch({ storeExists: false });
  assert.equal(patch.department_scope === "department", patch.department_id != null);
});
