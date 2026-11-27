import { test } from "node:test";
import assert from "node:assert/strict";
import { payrollMonthRange } from "./month-range.ts";

test("month bounds, including the year boundary", () => {
  assert.deepEqual(payrollMonthRange("2026-11"), { from: "2026-11-01", until: "2026-12-01" });
  assert.deepEqual(payrollMonthRange("2026-12"), { from: "2026-12-01", until: "2027-01-01" });
});

test("anything but YYYY-MM is refused", () => {
  for (const bad of ["2026-13", "2026-1", "2026-11-01", "", "abc"]) assert.throws(() => payrollMonthRange(bad));
});
