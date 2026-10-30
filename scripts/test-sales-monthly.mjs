import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const dir = await mkdtemp(join(tmpdir(), "sales-monthly-"));
try {
  for (const name of ["types", "monthly"]) {
    const code = ts
      .transpileModule(await readFile(`src/lib/sales/${name}.ts`, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.ES2022,
          target: ts.ScriptTarget.ES2022,
        },
      })
      .outputText.replace('from "./types"', 'from "./types.mjs"');
    await writeFile(join(dir, `${name}.mjs`), code);
  }
  const { aggregateSalesMonths: aggregate, monthBounds } = await import(
    pathToFileURL(join(dir, "monthly.mjs")).href
  );
  const day = (date, calculated, overrides = {}) => ({
    id: date,
    account_id: "account",
    venue_id: "venue",
    business_date: date,
    status: "complete",
    calculated,
    overrides,
    sync_error: null,
  });
  const rows = aggregate([
    day("2026-09-01", {
      turnover: 1000,
      hookah: 100,
      tips: 50,
      service: 25,
      checks: 5,
    }),
    day("2026-09-02", {
      turnover: 100,
      hookah: 100,
      tips: 0,
      service: 0,
      checks: 1,
    }),
    day("2026-10-01", {
      turnover: 0,
      hookah: 0,
      tips: 0,
      service: 0,
      checks: 0,
    }),
  ]);
  assert.equal(rows[0].month, "2026-10");
  const september = rows[1],
    october = rows[0];
  assert.equal(
    september.hookahShare,
    18.18,
    "Use the weighted share, not the mean of daily percentages",
  );
  assert.equal(september.barShare, 81.82);
  assert.equal(september.perShift, 550);
  assert.equal(
    september.totals.tips_total.value,
    75,
    "Combine tips and service exactly once",
  );
  assert.equal(october.perShift, 0, "A known zero remains known");
  assert.equal(
    october.hookahShare,
    null,
    "No percentage of a zero denominator",
  );
  const partial = aggregate([
    day("2026-09-01", { turnover: 1000, hookah: 100 }),
    day("2026-09-02", { turnover: 100, hookah: null }),
    day("2026-09-03", {}),
  ])[0];
  assert.deepEqual(partial.totals.turnover, {
    value: 1100,
    known: 2,
    total: 3,
  });
  assert.equal(
    partial.hookahShare,
    null,
    "Never divide unmatched partial cohorts",
  );
  assert.equal(partial.barShare, null);
  assert.equal(partial.perShift, 550);
  assert.deepEqual(partial.totals.taxi, { value: null, known: 0, total: 3 });
  const fixed = aggregate([
    day(
      "2026-09-01",
      { turnover: 100, hookah: 20, tips: 5, service: 2 },
      { turnover: 200, tips: 10 },
    ),
  ])[0];
  assert.equal(
    fixed.totals.bar.value,
    180,
    "Use effective values after corrections",
  );
  assert.equal(fixed.totals.tips_total.value, 12);
  assert.equal(fixed.corrected, 1);
  assert.deepEqual(monthBounds("2024-02"), {
    from: "2024-02-01",
    to: "2024-02-29",
  });
  assert.equal(monthBounds("2026-02").to, "2026-02-28");
  assert.throws(() => monthBounds("2026-13"));
  assert.throws(() => aggregate([day("2026-02-30", {})]));
  assert.throws(() =>
    aggregate([day("2026-09-01", {}), day("2026-09-01", {})]),
  );
  assert.throws(() =>
    aggregate([
      day("2026-09-01", {}),
      { ...day("2026-09-02", {}), venue_id: "other" },
    ]),
  );
  console.log(
    "PASS: weighted shares, null coverage, zero denominators, corrected metrics, exact month drilldown, duplicate and tenant guards",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
