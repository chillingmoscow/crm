import test from "node:test";
import assert from "node:assert/strict";

import { casualPayModel } from "./casual-pay-model.ts";

// Как на проде: у каждой должности одна модель по умолчанию; «Старший
// бармен» — отдельная должность со своей моделью; «Артем Боков» —
// персональная модель мастера (не по умолчанию).
const roles = [
  { id: "bar", department_id: "bar-dept" },
  { id: "senior-bar", department_id: "bar-dept" },
  { id: "barback", department_id: "kitchen" },
  { id: "master", department_id: "hookah" },
];
const models = [
  { id: "m-bar", role_id: "bar", is_role_default: true },
  { id: "m-senior-bar", role_id: "senior-bar", is_role_default: true },
  { id: "m-barback", role_id: "barback", is_role_default: true },
  { id: "m-master", role_id: "master", is_role_default: true },
  { id: "m-personal", role_id: "master", is_role_default: false },
];
const kristine = { role_id: "bar", model_id: "m-bar" };

test("своя должность — своя модель", () => {
  assert.equal(casualPayModel({ employee: kristine, shift: { role_id: "bar" }, models, roles }), "m-bar");
});

test("другая должность в своём подразделении — своя модель", () => {
  assert.equal(casualPayModel({ employee: kristine, shift: { role_id: "senior-bar" }, models, roles }), "m-bar");
});

test("чужое подразделение — модель должности смены", () => {
  assert.equal(casualPayModel({ employee: kristine, shift: { role_id: "barback" }, models, roles }), "m-barback");
});

test("персональная модель сохраняется на своей должности", () => {
  assert.equal(
    casualPayModel({ employee: { role_id: "master", model_id: "m-personal" }, shift: { role_id: "master" }, models, roles }),
    "m-personal",
  );
});

test("до даты правила подразделения — модель должности смены", () => {
  assert.equal(
    casualPayModel({
      employee: kristine,
      shift: { role_id: "senior-bar", starts_at: "2026-11-01T10:00:00Z" },
      models,
      roles,
      sameDepartmentRateFrom: "2026-11-09T07:09:21Z",
    }),
    "m-senior-bar",
  );
});

test("без должности смены или без оплаты у должности — null", () => {
  assert.equal(casualPayModel({ employee: kristine, shift: { role_id: null }, models, roles }), null);
  assert.equal(
    casualPayModel({ employee: kristine, shift: { role_id: "ghost" }, models, roles: [...roles, { id: "ghost", department_id: "x" }] }),
    null,
  );
});
