import test from "node:test";
import assert from "node:assert/strict";
import { officialMonthOptions, validateOfficialForm } from "./official-settings.ts";

const ok = { from: "2026-11-01", payDay: "5", bankId: "b1" };

test("month options start at payroll start and include saved month", () => {
  const o = officialMonthOptions("2026-09-15", "2026-01-01", "2026-11-24");
  assert.equal(o[0].value, "");
  assert.equal(o[1].value, "2026-01-01");
  assert.equal(o[2].value, "2026-09-01");
  assert.equal(o.at(-1)!.value, "2027-11-01");
  assert.equal(o.find((x) => x.value === "2026-11-01")!.label, "Ноябрь 2026");
});

test("valid form passes, empty month and bank allowed", () => {
  assert.equal(validateOfficialForm(ok, "2026-01-01", ["b1"]), null);
  assert.equal(validateOfficialForm({ from: "", payDay: "28", bankId: "" }, "2026-01-01", []), null);
});

test("rejects month before payroll start", () => {
  assert.match(validateOfficialForm({ ...ok, from: "2026-08-01" }, "2026-09-15", ["b1"])!, /раньше начала/);
});

test("rejects bad pay day", () => {
  for (const d of ["0", "29", "", "5.5", "abc", "-1"])
    assert.match(validateOfficialForm({ ...ok, payDay: d }, "2026-01-01", ["b1"])!, /от 1 до 28/);
});

test("rejects non-checking bank", () => {
  assert.match(validateOfficialForm({ ...ok, bankId: "x" }, "2026-01-01", ["b1"])!, /расчётный счёт/);
});
