import test from "node:test";
import assert from "node:assert/strict";

import { dateInZone, timeInZone } from "./utils.ts";

test("dateInZone: дата по часам заведения, кэш не путает пояса", () => {
  const value = "2026-11-18T22:30:00Z";
  assert.equal(dateInZone(value, "Europe/Moscow"), "2026-11-19");
  assert.equal(dateInZone(value, "UTC"), "2026-11-18");
  assert.equal(dateInZone(value, "America/New_York"), "2026-11-18");
  // Повторный вызов отдаёт тот же ответ из кэша.
  assert.equal(dateInZone(value, "Europe/Moscow"), "2026-11-19");
  assert.equal(dateInZone(value, "UTC"), "2026-11-18");
});

test("dateInZone: Date не кэшируется по ссылке", () => {
  const moment = new Date("2026-11-18T20:59:59Z");
  assert.equal(dateInZone(moment, "Europe/Moscow"), "2026-11-18");
  moment.setTime(Date.parse("2026-11-18T21:00:00Z"));
  assert.equal(dateInZone(moment, "Europe/Moscow"), "2026-11-19");
});

test("timeInZone: часы и минуты в поясе заведения", () => {
  assert.equal(timeInZone("2026-11-18T22:30:00Z", "Europe/Moscow"), "01:30");
  assert.equal(timeInZone("2026-11-18T22:30:00Z", "UTC"), "22:30");
});
