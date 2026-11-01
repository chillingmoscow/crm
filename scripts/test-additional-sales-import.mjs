import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  prepareAdditionalArchive,
  additionalImportSql,
} from "./prepare-additional-sales-import.mjs";
const input = JSON.parse(await readFile(process.argv[2], "utf8"));
const target = JSON.parse(await readFile(process.argv[3], "utf8"));
const plan = prepareAdditionalArchive(input, target.legacy_venue_id);
assert.equal(plan.records.length, 303);
assert.equal(plan.duplicates.length, 1);
assert.equal(plan.held.length, 1);
const masters = plan.records.find(
  (r) => r.kind === "masters" && r.business_date === "2026-06-28",
);
assert.equal(masters.origin.ranges.length, 2);
assert.ok(!JSON.stringify(plan.records).includes("Дополнительный доход"));
const alter = (run) => {
  const next = structuredClone(input);
  run(next);
  return next;
};
assert.deepEqual(
  prepareAdditionalArchive(
    alter((s) => {
      for (const row of s.sheets.KPI.values.slice(1))
        if (row.length > 8) row[8] = 9999999;
    }),
    target.legacy_venue_id,
  ).records,
  plan.records,
  "excluded income changed archive/hash",
);
assert.throws(
  () =>
    prepareAdditionalArchive(
      alter((s) => {
        s.sheets.Sales.values[0][5] = "Unknown";
      }),
      target.legacy_venue_id,
    ),
  /заголовки/,
);
assert.throws(
  () =>
    prepareAdditionalArchive(
      alter((s) => {
        s.sheets.Sales.values[1][3] = "foreign-venue";
      }),
      target.legacy_venue_id,
    ),
  /заведение/,
);
assert.throws(
  () =>
    prepareAdditionalArchive(
      alter((s) => {
        s.sheets.KPI.values[29][7] += 1;
      }),
      target.legacy_venue_id,
    ),
  /Конфликт/,
);
assert.throws(
  () =>
    prepareAdditionalArchive(
      alter((s) => {
        s.sheets.Sales.values[1][1] = 12;
      }),
      target.legacy_venue_id,
    ),
  /Дата/,
);
const nullable = prepareAdditionalArchive(
  alter((s) => {
    s.sheets.Sales.values[1][8] = null;
    s.sheets.Sales.values[1][9] = 0;
  }),
  target.legacy_venue_id,
).records.find((r) => r.kind === "bar");
assert.equal(nullable.metrics.quantities.tea, null);
assert.equal(nullable.metrics.quantities.additions, 0);
const hostile = structuredClone(plan);
hostile.records[0].origin.raw.note = "$import$;select 'source-text';--\\\n";
const sql = additionalImportSql(hostile, target);
const doBody = sql.slice(sql.indexOf("do $import$"));
assert.ok(!doBody.includes("source-text"));
assert.ok(sql.includes("select ''source-text''"));
assert.throws(
  () =>
    additionalImportSql(plan, {
      ...target,
      venue_id: "';delete from transactions;--",
    }),
  /ID/,
);
console.log(
  "PASS: 303 source snapshots, exact duplicate, incomplete row held, excluded income/hash, scope/header/date/conflict guards, null/zero and SQL literal isolation",
);
