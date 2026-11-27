import test from "node:test";
import assert from "node:assert/strict";

import {
  kbOverviewBlocks,
  kbOverviewNextDisabled,
  kbOverviewPeriodLabel,
  kbOverviewPeriodQuery,
  kbOverviewWindow,
  parseKbOverviewPeriod,
  shiftKbOverviewPeriod,
} from "./overview.ts";

const set = (...codes: string[]) => new Set(codes);

test("kbOverviewBlocks: аналитика — показатели, популярное, тренд и «По страницам»", () => {
  assert.deepEqual(kbOverviewBlocks(set("kb.view_analytics")), {
    metrics: true,
    attention: false,
    popular: true,
    trend: true,
    changes: false,
    pagesView: true,
  });
});

test("kbOverviewBlocks: обязательное чтение — только «Требует внимания»", () => {
  assert.deepEqual(kbOverviewBlocks(set("kb.manage_required_reading")), {
    metrics: false,
    attention: true,
    popular: false,
    trend: false,
    changes: false,
    pagesView: false,
  });
});

test("kbOverviewBlocks: журнал — только «Последние изменения»", () => {
  const blocks = kbOverviewBlocks(set("org.view_audit"));
  assert.equal(blocks.changes, true);
  assert.equal(blocks.metrics || blocks.attention || blocks.popular || blocks.pagesView, false);
});

test("kbOverviewBlocks: все права — все блоки", () => {
  const blocks = kbOverviewBlocks(set("kb.view_analytics", "kb.manage_required_reading", "org.view_audit"));
  assert.ok(Object.values(blocks).every(Boolean));
});

test("parseKbOverviewPeriod: по умолчанию — текущая неделя с понедельника", () => {
  // 27.11.2026 — пятница.
  assert.deepEqual(parseKbOverviewPeriod({}, "2026-11-27"), { kind: "week", start: "2026-11-23" });
});

test("parseKbOverviewPeriod: месяц и неделя из адреса, неделя выравнивается на понедельник", () => {
  assert.deepEqual(parseKbOverviewPeriod({ period: "month", from: "2026-10" }, "2026-11-27"), {
    kind: "month",
    start: "2026-10",
  });
  assert.deepEqual(parseKbOverviewPeriod({ period: "week", from: "2026-11-19" }, "2026-11-27"), {
    kind: "week",
    start: "2026-11-16",
  });
  assert.deepEqual(parseKbOverviewPeriod({ period: "month", from: "мусор" }, "2026-11-27"), {
    kind: "month",
    start: "2026-11",
  });
});

test("shiftKbOverviewPeriod: шаг через границу года", () => {
  assert.deepEqual(shiftKbOverviewPeriod({ kind: "week", start: "2026-12-28" }, 1), {
    kind: "week",
    start: "2027-01-04",
  });
  assert.deepEqual(shiftKbOverviewPeriod({ kind: "month", start: "2026-01" }, -1), {
    kind: "month",
    start: "2025-12",
  });
});

test("kbOverviewWindow: неделя — 7 суток с понедельника, месяц — календарный", () => {
  assert.deepEqual(kbOverviewWindow({ kind: "week", start: "2026-11-23" }), {
    sinceISO: "2026-11-23T00:00:00.000Z",
    untilISO: "2026-11-30T00:00:00.000Z",
  });
  assert.deepEqual(kbOverviewWindow({ kind: "month", start: "2026-02" }), {
    sinceISO: "2026-02-01T00:00:00.000Z",
    untilISO: "2026-03-01T00:00:00.000Z",
  });
});

test("kbOverviewNextDisabled: дальше текущего периода не шагаем", () => {
  assert.equal(kbOverviewNextDisabled({ kind: "week", start: "2026-11-23" }, "2026-11-27"), true);
  assert.equal(kbOverviewNextDisabled({ kind: "week", start: "2026-11-16" }, "2026-11-27"), false);
  assert.equal(kbOverviewNextDisabled({ kind: "month", start: "2026-11" }, "2026-11-27"), true);
});

test("kbOverviewPeriodLabel и адрес", () => {
  assert.equal(kbOverviewPeriodLabel({ kind: "week", start: "2026-11-23" }), "23–29 нояб. 2026");
  assert.equal(kbOverviewPeriodLabel({ kind: "week", start: "2026-11-30" }), "30 нояб. – 6 дек. 2026");
  assert.equal(kbOverviewPeriodLabel({ kind: "month", start: "2026-11" }), "Ноябрь 2026");
  assert.equal(kbOverviewPeriodQuery({ kind: "month", start: "2026-11" }), "period=month&from=2026-11");
});
