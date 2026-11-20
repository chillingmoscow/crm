import { test } from "node:test";
import assert from "node:assert/strict";

import { zonedDayStartIso } from "./day-bounds.ts";

test("полночь по Москве — 21:00 UTC предыдущего дня", () => {
  assert.equal(
    zonedDayStartIso("2026-11-20", "Europe/Moscow"),
    "2026-11-19T21:00:00.000Z",
  );
});

test("addDays даёт исключающую верхнюю границу", () => {
  assert.equal(
    zonedDayStartIso("2026-11-20", "Europe/Moscow", 1),
    "2026-11-20T21:00:00.000Z",
  );
  assert.equal(
    zonedDayStartIso("2026-12-31", "Europe/Moscow", 1),
    "2026-12-31T21:00:00.000Z",
  );
});

test("пояс восточнее и UTC", () => {
  assert.equal(
    zonedDayStartIso("2026-11-20", "Asia/Vladivostok"),
    "2026-11-19T14:00:00.000Z",
  );
  assert.equal(zonedDayStartIso("2026-11-20", "UTC"), "2026-11-20T00:00:00.000Z");
});

test("день перехода на летнее время не съезжает", () => {
  // 29.03.2026 Берлин переходит с +01:00 на +02:00 в 02:00 — полночь ещё +01:00.
  assert.equal(
    zonedDayStartIso("2026-03-29", "Europe/Berlin"),
    "2026-03-28T23:00:00.000Z",
  );
  assert.equal(
    zonedDayStartIso("2026-03-30", "Europe/Berlin"),
    "2026-03-29T22:00:00.000Z",
  );
});

test("невалидная дата → null", () => {
  assert.equal(zonedDayStartIso("2026-11", "Europe/Moscow"), null);
  assert.equal(zonedDayStartIso("", "Europe/Moscow"), null);
});
