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

test("agency: true только явно, без столбца — обычное оформление", () => {
  const [plain, agency, missing] = normalizeOfficialExpected([
    { ...row("a", 1), agency: false },
    { ...row("b", "4350.00"), agency: true },
    row("c", 2),
  ]);
  assert.equal(plain.agency, false);
  assert.equal(agency.agency, true);
  assert.equal(agency.gross, 4350);
  assert.equal(missing.agency, false);
});
