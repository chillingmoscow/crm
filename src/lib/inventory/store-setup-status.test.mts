import { test } from "node:test";
import assert from "node:assert/strict";

import { storeSetupStatus } from "./store-setup-status.ts";

const base = { venueId: "v1", scope: "shared" as const, departmentId: null, departmentArchived: false };

test("склад без заведения — первым делом заведение, даже если подразделение не задано", () => {
  assert.equal(storeSetupStatus({ ...base, venueId: null, scope: "unset" }), "no_venue");
  // «Общий склад» переживает снятие заведения, но акты без заведения всё равно не посчитать.
  assert.equal(storeSetupStatus({ ...base, venueId: null }), "no_venue");
});

test("«Не задано» — не то же, что «Общий склад»", () => {
  assert.equal(storeSetupStatus({ ...base, scope: "unset" }), "no_department");
  assert.equal(storeSetupStatus(base), "ready");
});

test("привязка к подразделению: живое — готов, архивное — внимание", () => {
  assert.equal(storeSetupStatus({ ...base, scope: "department", departmentId: "d1" }), "ready");
  assert.equal(
    storeSetupStatus({ ...base, scope: "department", departmentId: "d1", departmentArchived: true }),
    "archived_department",
  );
});

test("вариант «Подразделение» без самого подразделения не выдаётся за настроенный", () => {
  assert.equal(storeSetupStatus({ ...base, scope: "department", departmentId: null }), "no_department");
});
