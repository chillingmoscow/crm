import { test } from "node:test";
import assert from "node:assert/strict";
import { quickDateISO, formatPropertyDate } from "./date-control-helpers.ts";

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

test("formatPropertyDate renders ru short form", () => {
  assert.equal(formatPropertyDate("2026-04-15"), "15 апр. 2026 г.");
});

test("formatPropertyDate returns empty string for empty input", () => {
  assert.equal(formatPropertyDate(""), "");
  assert.equal(formatPropertyDate(null), "");
});
