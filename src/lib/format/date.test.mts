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

test("formatDateCell: момент в поясе заведения", () => {
  // 22:30 UTC 16-го — в Москве уже 17-е.
  assert.equal(formatDateCell("2026-11-16T22:30:00Z", "Europe/Moscow"), "17.11.2026");
  assert.equal(formatDateCell("2026-11-16T22:30:00Z", "UTC"), "16.11.2026");
});

test("formatDateCell: голая дата пояс не сдвигает", () => {
  assert.equal(formatDateCell("2026-11-16", "America/Los_Angeles"), "16.11.2026");
  assert.equal(formatDateCell("2026-11-16", "Asia/Kamchatka"), "16.11.2026");
});

test("formatDayMonthTime: «16 ноября, 14:05» в поясе", () => {
  assert.equal(
    formatDayMonthTime("2026-11-16T11:05:00Z", now, "Europe/Moscow"),
    "16 ноября, 14:05",
  );
  assert.equal(
    formatDayMonthTime("2026-11-16T22:30:00Z", now, "Europe/Moscow"),
    "17 ноября, 01:30",
  );
});

test("formatDayMonth: год только для другого года", () => {
  assert.equal(formatDayMonth("2026-03-08", now, "Europe/Moscow"), "8 марта");
  assert.match(formatDayMonth("2025-03-08", now, "Europe/Moscow") ?? "", /^8 марта 2025/);
});
