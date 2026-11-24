import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOfficialExpected } from "./official-expected.ts";

const row = (employee_id: string, gross: number | string | null) => ({
  employee_id, employment_id: "e", month: "2026-11-01", kind: "full" as const,
  gross, days_paid: null, days_in_month: 30,
});

test("gross приводится к числу, null остаётся null", () => {
  const out = normalizeOfficialExpected([row("a", "12000.50"), row("b", null)]);
  assert.equal(out[0].gross, 12000.5);
  assert.equal(out[1].gross, null);
});

test("фильтр по сотруднику", () => {
  const rows = [row("a", 1), row("b", 2)];
  assert.deepEqual(normalizeOfficialExpected(rows, "b").map((r) => r.employee_id), ["b"]);
  assert.equal(normalizeOfficialExpected(rows).length, 2);
  assert.deepEqual(normalizeOfficialExpected(null), []);
});
