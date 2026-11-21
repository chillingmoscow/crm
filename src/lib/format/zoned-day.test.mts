import test from "node:test";
import assert from "node:assert/strict";

import { calendarDateInZone, dayEndExclusiveInZone, dayStartInZone } from "./zoned-day.ts";

test("ночная выплата по Москве — уже следующий день", () => {
  assert.equal(calendarDateInZone("2026-11-21T22:30:00Z", "Europe/Moscow"), "2026-11-22");
  assert.equal(calendarDateInZone("2026-11-21T22:30:00Z", "UTC"), "2026-11-21");
});

test("ручная операция (полночь UTC) остаётся в своём дне во всех поясах списка", () => {
  for (const tz of ["UTC", "Europe/Kaliningrad", "Europe/Moscow", "Asia/Vladivostok", "Asia/Kamchatka"]) {
    assert.equal(calendarDateInZone("2026-11-21T00:00:00+00:00", tz), "2026-11-21", tz);
  }
});

test("голая дата не сдвигается", () => {
  assert.equal(calendarDateInZone("2026-11-21", "Asia/Kamchatka"), "2026-11-21");
});

test("начало и конец дня в поясе", () => {
  assert.equal(dayStartInZone("2026-11-21", "Europe/Moscow"), "2026-11-20T21:00:00.000Z");
  assert.equal(dayEndExclusiveInZone("2026-11-21", "Europe/Moscow"), "2026-11-21T21:00:00.000Z");
  assert.equal(dayStartInZone("2026-11-21", "UTC"), "2026-11-21T00:00:00.000Z");
  assert.equal(dayEndExclusiveInZone("2026-12-31", "Asia/Kamchatka"), "2026-12-31T12:00:00.000Z");
});

test("переход на летнее время учитывается", () => {
  // Европа/Киев: 29.03.2026 в 03:00 переход на UTC+3; полночь ещё UTC+2.
  assert.equal(dayStartInZone("2026-03-29", "Europe/Kiev"), "2026-03-28T22:00:00.000Z");
  assert.equal(dayStartInZone("2026-03-30", "Europe/Kiev"), "2026-03-29T21:00:00.000Z");
});
