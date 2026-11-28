import { test } from "node:test";
import assert from "node:assert/strict";
import {
  additionalTabs,
  additionalValue,
  departmentRows,
  readyUpsellResult,
  upsellUnknown,
  type AdditionalViewData,
} from "./additional-view.ts";
import {
  defaultAdditionalRules,
  type AdditionalDay,
  type AdditionalKind,
} from "./additional.ts";
import type { UpsellDayResult, UpsellLine } from "./upsell.ts";

const BAR = "11111111-1111-4111-8111-111111111111";
const MASTERS = "22222222-2222-4222-8222-222222222222";
const MANAGERS = "33333333-3333-4333-8333-333333333333";

const report = (
  date: string,
  kind: AdditionalKind,
  bonus: number,
  extra: Partial<AdditionalDay> = {},
): AdditionalDay => ({
  id: `r-${kind}-${date}`,
  venue_id: "v",
  business_date: date,
  kind,
  metrics: {
    revenue: 10000,
    primeCost: 3000,
    bonus,
    points: kind === "masters" ? 4 : null,
    quantities: { tea: 2 },
  },
  request: { rules: defaultAdditionalRules, rule_id: "old" },
  metrics_request: null,
  state: "ready",
  last_error: null,
  synced_at: null,
  period_start: null,
  period_end: null,
  ...extra,
});

const lines: UpsellLine[] = [
  { target: "dish", external_id: "11", name: "Негрони", rate: 180 },
  { target: "dish_group", external_id: "5", name: "Чай", rate: 100 },
];
const result = (bonus: number, extra: Partial<UpsellDayResult> = {}): UpsellDayResult => ({
  bonus,
  lines: [
    { key: "dish:11", quantity: 2, amount: 360 },
    { key: "dish_group:5", quantity: 0, amount: 0 },
  ],
  paid: { "dish:11": "dish:11" },
  unknown: [],
  ...extra,
});

function data(over: Partial<AdditionalViewData> = {}): AdditionalViewData {
  return {
    venueId: "v",
    reports: [],
    days: [],
    departments: [
      { id: BAR, name: "Бар", legacyKind: "bar" },
      { id: MASTERS, name: "Кальяны", legacyKind: "masters" },
      { id: MANAGERS, name: "Менеджеры", legacyKind: null },
    ],
    upsellRules: [
      {
        id: "v1",
        department_id: BAR,
        valid_from: "2026-11-20",
        created_at: "2026-11-19T10:00:00Z",
        lines,
      },
    ],
    upsellDays: [],
    ...over,
  };
}

test("день до перехода берётся из старой очереди, день перехода — из расчёта по чекам", () => {
  const rows = departmentRows(
    data({
      reports: [
        report("2026-11-19", "bar", 500),
        report("2026-11-20", "bar", 999),
        report("2026-11-19", "masters", 700),
      ],
      upsellDays: [
        {
          id: "d20",
          department_id: BAR,
          business_date: "2026-11-20",
          state: "ready",
          result: result(360),
          last_error: null,
          computed_at: "2026-11-21T06:00:00Z",
          provisional: false,
        },
      ],
    }),
    BAR
  );
  assert.deepEqual(
    rows.map((r) => [r.date, !!r.upsell, !!r.native]),
    [
      ["2026-11-20", true, false],
      ["2026-11-19", false, true],
    ],
  );
  const [switchDay, before] = rows;
  assert.equal(additionalValue(switchDay, "bonus"), 360);
  assert.equal(additionalValue(switchDay, "dish:11"), 2);
  assert.equal(additionalValue(switchDay, "dish_group:5"), 0);
  assert.equal(additionalValue(switchDay, "tea"), null);
  assert.equal(additionalValue(switchDay, "points"), null);
  assert.deepEqual(switchDay.upsell?.lines, lines);
  assert.equal(additionalValue(before, "bonus"), 500);
  assert.equal(additionalValue(before, "tea"), 2);
});

test("выручка дня перехода из отчёта бара", () => {
  const [row] = departmentRows(
    data({
      reports: [
        report("2026-11-20", "bar", 999, {
          metrics: {
            revenue: 45000,
            primeCost: 12000,
            bonus: 999,
            points: null,
            quantities: {},
          },
        }),
        report("2026-11-20", "masters", 1),
      ],
      upsellDays: [
        {
          id: "d20",
          department_id: BAR,
          business_date: "2026-11-20",
          state: "ready",
          result: result(360),
          last_error: null,
          computed_at: null,
          provisional: false,
        },
      ],
    }),
    BAR
  );
  assert.equal(additionalValue(row, "revenue"), 45000);
  assert.equal(additionalValue(row, "primeCost"), 12000);
  assert.equal(additionalValue(row, "bonus"), 360);
  assert.equal(row.upsell?.report?.id, "r-bar-2026-11-20");
});

test("день без результата — bonus null, не 0", () => {
  const rows = departmentRows(
    data({
      upsellDays: [
        {
          id: "d21",
          department_id: BAR,
          business_date: "2026-11-21",
          state: "pending",
          result: null,
          last_error: null,
          computed_at: null,
          provisional: false,
        },
        {
          id: "d22",
          department_id: BAR,
          business_date: "2026-11-22",
          state: "error",
          result: null,
          last_error: "Чеки дня ещё не загружены",
          computed_at: null,
          provisional: false,
        },
      ],
    }),
    BAR
  );
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(additionalValue(r, "bonus"), null);
    assert.equal(additionalValue(r, "dish:11"), null);
    assert.equal(additionalValue(r, "revenue"), null);
  }
});

test("день перехода в состоянии пересчёта (не ready, со старым result) — bonus null", () => {
  const [row] = departmentRows(
    data({
      upsellDays: [
        {
          id: "d20",
          department_id: BAR,
          business_date: "2026-11-20",
          state: "running",
          result: result(360, {
            unknown: [{ key: "dish:99", quantity: 1 }],
          }),
          last_error: null,
          computed_at: "2026-11-21T06:00:00Z",
          provisional: false,
        },
      ],
    }),
    BAR
  );
  assert.equal(additionalValue(row, "bonus"), null);
  assert.equal(additionalValue(row, "dish:11"), null);
  assert.deepEqual(upsellUnknown([row]), []);
});

test("подразделение без правил — все дни из старой очереди своего вида", () => {
  const rows = departmentRows(
    data({
      reports: [
        report("2026-11-19", "masters", 700),
        report("2026-11-25", "masters", 800),
        report("2026-11-25", "bar", 1),
      ],
    }),
    MASTERS
  );
  assert.deepEqual(
    rows.map((r) => [r.date, additionalValue(r, "bonus"), additionalValue(r, "points")]),
    [
      ["2026-11-25", 800, 4],
      ["2026-11-19", 700, 4],
    ],
  );
});

test("подразделение без старого вида — только дни по чекам, чужие дни не попадают", () => {
  const rows = departmentRows(
    data({
      reports: [report("2026-11-20", "bar", 500)],
      upsellRules: [
        {
          id: "m1",
          department_id: MANAGERS,
          valid_from: "2026-11-20",
          created_at: "2026-11-19T10:00:00Z",
          lines: [lines[0]],
        },
      ],
      upsellDays: [
        {
          id: "m20",
          department_id: MANAGERS,
          business_date: "2026-11-20",
          state: "ready",
          result: { bonus: 40, lines: [{ key: "dish:11", quantity: 2, amount: 40 }], paid: {}, unknown: [] },
          last_error: null,
          computed_at: null,
          provisional: false,
        },
        {
          id: "b20",
          department_id: BAR,
          business_date: "2026-11-20",
          state: "ready",
          result: result(360),
          last_error: null,
          computed_at: null,
          provisional: false,
        },
      ],
    }),
    MANAGERS
  );
  assert.equal(rows.length, 1);
  assert.equal(additionalValue(rows[0], "bonus"), 40);
  assert.equal(additionalValue(rows[0], "revenue"), null);
  assert.equal(rows[0].kind, null);
});

test("строки дня — из версии, действующей на дату", () => {
  const v2: UpsellLine[] = [{ ...lines[0], rate: 200 }];
  const rows = departmentRows(
    data({
      upsellRules: [
        { id: "v2", department_id: BAR, valid_from: "2026-11-22", created_at: "2026-11-21T00:00:00Z", lines: v2 },
        { id: "v1", department_id: BAR, valid_from: "2026-11-20", created_at: "2026-11-19T10:00:00Z", lines },
      ],
      upsellDays: ["2026-11-21", "2026-11-22"].map((d) => ({
        id: d,
        department_id: BAR,
        business_date: d,
        state: "ready" as const,
        result: result(1),
        last_error: null,
        computed_at: null,
        provisional: false,
      })),
    }),
    BAR
  );
  assert.deepEqual(
    rows.map((r) => [r.date, r.upsell?.lines]),
    [
      ["2026-11-22", v2],
      ["2026-11-21", lines],
    ],
  );
});

test("перенесённые из Glide дни — рядом с днями по чекам", () => {
  const rows = departmentRows(
    data({
      reports: [
        report("2025-01-10", "bar", 300, {
          request: {
            rules: defaultAdditionalRules,
            rule_id: "r",
            imported_from: "glide",
          },
        }),
      ],
      upsellDays: [
        {
          id: "d20",
          department_id: BAR,
          business_date: "2026-11-20",
          state: "ready",
          result: result(360),
          last_error: null,
          computed_at: null,
          provisional: false,
        },
      ],
    }),
    BAR,
  );
  assert.deepEqual(rows.map((r) => [r.date, additionalValue(r, "bonus")]), [
    ["2026-11-20", 360],
    ["2025-01-10", 300],
  ]);
});

test("вкладки — подразделения с правилами или старым видом", () => {
  const d = data({
      upsellRules: [],
      reports: [report("2026-11-19", "masters", 700)],
      departments: [
        { id: BAR, name: "Бар", legacyKind: "bar" },
        { id: MANAGERS, name: "Менеджеры", legacyKind: null },
        { id: "x", name: "Кухня", legacyKind: null },
      ],
    });
  const tabs = additionalTabs(d);
  assert.deepEqual(
    tabs.map((t) => [t.id, t.name, t.legacyKind]),
    [
      [BAR, "Бар", "bar"],
      ["legacy:masters", "Кальяны", "masters"],
    ],
  );
  assert.deepEqual(
    departmentRows(d, "legacy:masters").map((r) => additionalValue(r, "bonus")),
    [700],
  );
});

test("позиции не из номенклатуры — только по готовым дням, количества складываются", () => {
  const day = (id: string, state: "ready" | "running", unknown: UpsellDayResult["unknown"]) => ({
    id,
    department_id: BAR,
    business_date: id,
    state,
    result: result(1, { unknown }),
    last_error: null,
    computed_at: null,
    provisional: false,
  });
  const rows = departmentRows(
    data({
      upsellDays: [
        day("2026-11-20", "ready", [{ key: "dish:99", quantity: 1 }]),
        day("2026-11-21", "ready", [
          { key: "?:7", quantity: 2 },
          { key: "dish:99", quantity: 0.5 },
        ]),
        day("2026-11-22", "running", [{ key: "dish:5", quantity: 1 }]),
      ],
    }),
    BAR
  );
  assert.deepEqual(upsellUnknown(rows), [
    { key: "?:7", quantity: 2 },
    { key: "dish:99", quantity: 1.5 },
  ]);
});

test("предварительный день показывает последний расчёт и во время пересчёта", () => {
  const day = {
    id: "d",
    department_id: "dep",
    business_date: "2026-11-26",
    result: { bonus: 500, lines: [], paid: {}, unknown: [] },
    last_error: null,
    computed_at: "2026-11-26T15:00:00Z",
  };
  assert.equal(readyUpsellResult({ ...day, state: "pending", provisional: true })?.bonus, 500);
  assert.equal(readyUpsellResult({ ...day, state: "running", provisional: true })?.bonus, 500);
  // Закрытый день во время пересчёта — «нет данных», как раньше.
  assert.equal(readyUpsellResult({ ...day, state: "pending", provisional: false }), null);
  assert.equal(readyUpsellResult({ ...day, state: "ready", provisional: false })?.bonus, 500);
});
