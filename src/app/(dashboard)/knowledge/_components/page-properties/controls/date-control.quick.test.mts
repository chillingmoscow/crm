import { test } from "node:test";
import assert from "node:assert/strict";
import {
  quickDateISO,
  formatPropertyDate,
  splitDateValue,
  joinDateValue,
  toISO,
} from "./date-control-helpers.ts";

/** ISO даты, сдвинутой на `days` от сегодня (для relative-тестов). */
function isoFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toISO(d);
}

test("quickDateISO('today') returns the given anchor date as YYYY-MM-DD", () => {
  const anchor = new Date(2026, 3, 15); // 15 Apr 2026 local
  assert.equal(quickDateISO("today", anchor), "2026-04-15");
});

test("quickDateISO('tomorrow') adds one day", () => {
  const anchor = new Date(2026, 3, 15);
  assert.equal(quickDateISO("tomorrow", anchor), "2026-04-16");
});

test("quickDateISO('in7') adds seven days, crossing month", () => {
  const anchor = new Date(2026, 3, 28);
  assert.equal(quickDateISO("in7", anchor), "2026-05-05");
});

test("formatPropertyDate renders full ru form by default", () => {
  assert.equal(formatPropertyDate("2026-04-15"), "15 апреля 2026 г.");
  assert.equal(formatPropertyDate("2026-04-15", "full"), "15 апреля 2026 г.");
});

test("formatPropertyDate short form = dd.mm.yyyy", () => {
  assert.equal(formatPropertyDate("2026-04-15", "short"), "15.04.2026");
});

test("formatPropertyDate relative form near today", () => {
  assert.equal(formatPropertyDate(isoFromToday(0), "relative"), "Сегодня");
  assert.equal(formatPropertyDate(isoFromToday(1), "relative"), "Завтра");
  assert.equal(formatPropertyDate(isoFromToday(-1), "relative"), "Вчера");
  assert.equal(formatPropertyDate(isoFromToday(3), "relative"), "через 3 дн.");
  assert.equal(formatPropertyDate(isoFromToday(-4), "relative"), "4 дн. назад");
});

test("formatPropertyDate relative spans weeks / months / years", () => {
  assert.equal(formatPropertyDate(isoFromToday(14), "relative"), "через 2 нед.");
  assert.equal(formatPropertyDate(isoFromToday(60), "relative"), "через 2 мес.");
  assert.equal(
    formatPropertyDate(isoFromToday(-730), "relative"),
    "2 г. назад",
  );
});

test("formatPropertyDate returns empty string for empty input", () => {
  assert.equal(formatPropertyDate(""), "");
  assert.equal(formatPropertyDate(null), "");
});

test("formatPropertyDate appends time when present", () => {
  assert.equal(
    formatPropertyDate("2026-04-15T09:05"),
    "15 апреля 2026 г., 09:05",
  );
  assert.equal(
    formatPropertyDate("2026-04-15T09:05", "short"),
    "15.04.2026, 09:05",
  );
});

test("splitDateValue separates date and time", () => {
  assert.deepEqual(splitDateValue("2026-04-15T09:05"), {
    date: "2026-04-15",
    time: "09:05",
  });
  assert.deepEqual(splitDateValue("2026-04-15"), {
    date: "2026-04-15",
    time: null,
  });
  assert.deepEqual(splitDateValue(""), { date: "", time: null });
  assert.deepEqual(splitDateValue(null), { date: "", time: null });
});

test("joinDateValue round-trips with splitDateValue", () => {
  assert.equal(joinDateValue("2026-04-15", "09:05"), "2026-04-15T09:05");
  assert.equal(joinDateValue("2026-04-15", null), "2026-04-15");
  assert.equal(joinDateValue("", "09:05"), "");
});
