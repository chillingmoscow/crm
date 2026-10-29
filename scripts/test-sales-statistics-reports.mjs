import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const dir = await mkdtemp(join(tmpdir(), "statistics-reports-"));
try {
  for (const name of ["time", "types", "monthly", "statistics-reports"]) {
    const source = ts
      .transpileModule(await readFile(`src/lib/sales/${name}.ts`, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.ES2022,
          target: ts.ScriptTarget.ES2022,
        },
      })
      .outputText.replaceAll('"./time"', '"./time.mjs"')
      .replaceAll('"./types"', '"./types.mjs"')
      .replaceAll('"./monthly"', '"./monthly.mjs"');
    await writeFile(join(dir, name + ".mjs"), source);
  }
  const {
    statisticsReportWindow: window,
    parseStatisticsReport: parse,
    combineStatisticsMonths: combine,
  } = await import(pathToFileURL(join(dir, "statistics-reports.mjs")).href);
  const october = window(
    "2026-10",
    "Europe/Moscow",
    9,
    new Date("2026-10-29T19:00:00Z"),
  );
  assert.equal(
    new Date(october.start).toISOString(),
    "2026-10-01T06:00:00.000Z",
  );
  assert.equal(new Date(october.end).toISOString(), "2026-10-29T05:59:59.999Z");
  const beforeOpen = window(
    "2026-10",
    "Europe/Moscow",
    9,
    new Date("2026-10-29T05:30:00Z"),
  );
  assert.equal(beforeOpen.endDate, "2026-10-28");
  assert.equal(
    window("2026-11", "Europe/Moscow", 9, new Date("2026-10-29T19:00:00Z")),
    null,
  );
  const year = window(
    "2025-12",
    "Europe/Moscow",
    9,
    new Date("2026-01-01T06:01:00Z"),
  );
  assert.equal(new Date(year.end).toISOString(), "2026-01-01T05:59:59.999Z");
  const dst = window(
    "2026-10",
    "Europe/London",
    9,
    new Date("2026-11-01T10:00:00Z"),
  );
  assert.equal(new Date(dst.start).toISOString(), "2026-10-01T08:00:00.000Z");
  assert.equal(new Date(dst.end).toISOString(), "2026-11-01T08:59:59.999Z");
  assert.throws(() => window("2026-13", "Europe/Moscow", 9));
  assert.throws(() => window("0001-01", "Europe/Moscow", 9));
  assert.deepEqual(
    parse("alcohol", { utilityData: { aggregates: { salesSum: 0 } } }),
    { revenue: 0 },
  );
  assert.deepEqual(
    parse("regular_guests", {
      utilityData: { aggregates: { totalSum: "12345.67", customer: 19 } },
    }),
    { revenue: 12345.67, guests: 19 },
  );
  assert.deepEqual(
    parse("average_check", {
      ds: [{ object: { grouped: true, _Level: 0, salesSum: 2134.36 } }],
    }),
    { average: 2134.36 },
  );
  assert.deepEqual(
    parse("average_check", {
      utilityData: { aggregates: { orderNumber: 10, salesSum: 3210.98765 } },
      ds: [
        { object: { grouped: true, _Level: 0, salesSum: 3210.987654 } },
        { object: { salesSum: 15000 } },
      ],
    }),
    { average: 3210.99 },
  );
  assert.throws(() =>
    parse("alcohol", { utilityData: { aggregates: { totalSum: 100 } } }),
  );
  assert.throws(() =>
    parse("regular_guests", {
      utilityData: { aggregates: { totalSum: 100, customer: null } },
    }),
  );
  assert.throws(() =>
    parse("regular_guests", {
      utilityData: { aggregates: { totalSum: 100, customer: 1.5 } },
    }),
  );
  assert.throws(() => parse("average_check", { ds: [] }));
  assert.throws(() =>
    parse("average_check", { ds: [{ object: { salesSum: 15000 } }] }),
  );
  assert.throws(() =>
    parse("average_check", {
      ds: [{ object: { salesSum: 100 } }, { object: { salesSum: 300 } }],
    }),
  );
  const onlyReports = combine(
    [],
    [
      { venue_id: "venue-a", month: "2026-10-01" },
      { venue_id: "venue-a", month: "2026-10-01" },
      { venue_id: "venue-a", month: "2026-09-01" },
    ],
  );
  assert.deepEqual(
    onlyReports.map((m) => m.month),
    ["2026-10", "2026-09"],
  );
  assert.equal(onlyReports[0].shifts, 0);
  assert.deepEqual(onlyReports[0].totals.turnover, {
    value: null,
    known: 0,
    total: 0,
  });
  assert.equal(onlyReports[0].perShift, null);
  assert.throws(() =>
    combine(
      [],
      [
        { venue_id: "venue-a", month: "2026-10-01" },
        { venue_id: "venue-b", month: "2026-10-01" },
      ],
    ),
  );
  assert.throws(() =>
    combine([], [{ venue_id: "venue-a", month: "2026-10-02" }]),
  );
  console.log(
    "PASS: published report fields, known zero vs missing, no invented average, Moscow working day, open-day exclusion, year/month and DST boundaries",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
