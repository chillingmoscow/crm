import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const dir = await mkdtemp(join(tmpdir(), "statistics-reports-"));
try {
  for (const name of [
    "time",
    "types",
    "monthly",
    "statistics-reports",
    "statistics-view",
  ]) {
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
    const output = source.replaceAll(
      '"./statistics-reports"',
      '"./statistics-reports.mjs"',
    );
    await writeFile(join(dir, name + ".mjs"), output);
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
  const {
    statisticsRevenueShare: share,
    buildStatisticsRows: view,
    statisticsSeries: series,
  } = await import(pathToFileURL(join(dir, "statistics-view.mjs")).href);
  const day = (date, turnover, extra = {}) => ({
    id: date,
    account_id: "account",
    venue_id: "venue-a",
    business_date: date,
    status: "complete",
    calculated: { turnover },
    overrides: {},
    source_summary: {
      settings: { timezone: "Europe/Moscow", day_start_hour: 9 },
    },
    ...extra,
  });
  const report = {
    venue_id: "venue-a",
    month: "2026-10-01",
    kind: "alcohol",
    metrics: { revenue: 300 },
    period_start: "2026-10-01T06:00:00.000Z",
    period_end: "2026-10-03T05:59:59.999Z",
    through_date: "2026-10-02",
    state: "ready",
    synced_at: "2026-10-03T07:00:00Z",
  };
  const days = [
    day("2026-10-01", 1000),
    day("2026-10-02", 1000),
    day("2026-10-03", 9000, { status: "preliminary" }),
  ];
  assert.equal(
    share(report, days, "Europe/Moscow", 9).value,
    15,
    "Open day must not enter the denominator",
  );
  assert.equal(
    share(
      report,
      [
        day("2026-10-01", 1000, {
          source_summary: {
            settings: { timezone: "Europe/Moscow", day_start_hour: 12 },
          },
        }),
        days[1],
      ],
      "Europe/Moscow",
      9,
    ).value,
    null,
    "Daily provenance must use the same workday boundary",
  );
  assert.equal(
    share(report, days.slice(1), "Europe/Moscow", 9).value,
    null,
    "Missing day is not a smaller denominator",
  );
  assert.equal(
    share(report, [...days, days[0]], "Europe/Moscow", 9).value,
    null,
    "Duplicate source day",
  );
  assert.equal(
    share(
      report,
      [day("2026-10-01", 1000, { venue_id: "foreign" }), days[1]],
      "Europe/Moscow",
      9,
    ).value,
    null,
  );
  assert.equal(
    share(
      { ...report, period_start: "2026-10-01T09:00:00Z" },
      days,
      "Europe/Moscow",
      9,
    ).value,
    null,
    "Old 12:00 window must not mix with 09:00",
  );
  assert.equal(
    share(report, [day("2026-10-01", null), days[1]], "Europe/Moscow", 9).value,
    null,
  );
  assert.equal(
    share(
      report,
      [day("2026-10-01", 0), day("2026-10-02", 0)],
      "Europe/Moscow",
      9,
    ).value,
    null,
  );
  assert.equal(
    share({ ...report, metrics: { revenue: 0 } }, days, "Europe/Moscow", 9)
      .value,
    0,
  );
  assert.equal(
    share(
      report,
      [day("2026-10-01", 500, { overrides: { turnover: 2000 } }), days[1]],
      "Europe/Moscow",
      9,
    ).value,
    10,
    "Manual overrides participate",
  );
  const archive = {
    id: "snapshot",
    venue_id: "venue-a",
    month: "2026-10-01",
    metrics: { turnover: 500, bar: 0, alcoholRevenue: 50, alcoholShare: 17 },
    weekday_turnover: [1, 2, 3, 4, 5, 6, 7],
    captured_at: "2026-10-30T09:00:00Z",
    note: "history",
    origin: { range: "Statistics!A23:AC23" },
  };
  const archived = view(
    days,
    [report],
    [archive],
    "archive",
    "Europe/Moscow",
    9,
  );
  assert.equal(
    archived[0].values.alcoholShare.value,
    17,
    "Retain historical source percentage even if different from recomputation",
  );
  assert.equal(archived[0].values.bar.value, 0, "Known source zero");
  assert.equal(
    archived[0].values.shifts,
    undefined,
    "Do not infer shifts from average or calendar",
  );
  const live = view(days, [report], [archive], "native", "Europe/Moscow", 9);
  assert.equal(
    live[0].values.turnover.value,
    11000,
    "Archive never overwrites native turnover",
  );
  assert.equal(live[0].values.alcoholShare.value, 15);
  const revised = {
    ...archive,
    id: "new",
    metrics: { turnover: 700 },
    captured_at: "2026-10-31T09:00:00Z",
  };
  assert.equal(
    view([], [], [revised, archive], "archive", "Europe/Moscow", 9)[0].values
      .turnover.value,
    700,
    "Latest immutable snapshot wins independently of array order",
  );
  assert.throws(() =>
    view(
      days,
      [],
      [{ ...archive, venue_id: "foreign" }],
      "archive",
      "Europe/Moscow",
      9,
    ),
  );
  assert.deepEqual(
    series(
      [
        { month: "2026-08", values: { turnover: { value: 100 } } },
        { month: "2026-10", values: { turnover: { value: 0 } } },
      ],
      "turnover",
    ).map((p) => p.value),
    [100, null, 0],
    "Missing month breaks the chart line",
  );
  console.log(
    "PASS: published fields, report/day provenance and matching periods, missing/duplicate/foreign/open days, overrides, zero vs unknown, immutable archive choice and gaps in charts",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
