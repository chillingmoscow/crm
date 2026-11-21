import assert from "node:assert/strict";
import test from "node:test";

import { formatDateCell, formatDayMonth, formatDayMonthTime } from "./date.ts";

const now = new Date("2026-11-20T12:00:00Z");

test("formatDateCell: голая дата — календарный день", () => {
  assert.equal(formatDateCell("2026-11-16"), "16.11.2026");
  assert.equal(formatDateCell(null), null);
});

test("formatDayMonth: момент времени считается в поясе заведения", () => {
  // 21:30 UTC 19 ноября — в Москве уже 20 ноября.
  assert.equal(formatDayMonth("2026-11-19T21:30:00Z", now, "Europe/Moscow"), "20 ноября");
  assert.equal(formatDayMonth("2026-11-19T21:30:00Z", now, "UTC"), "19 ноября");
});

test("formatDayMonthTime: день и время в поясе заведения", () => {
  assert.equal(formatDayMonthTime("2026-11-19T21:30:00Z", now, "Europe/Moscow"), "20 ноября, 00:30");
});
