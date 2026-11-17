import test from "node:test";
import assert from "node:assert/strict";

import { instantInZone } from "./utils.ts";

test("Москва: UTC+3", () => {
  assert.equal(instantInZone("2026-11-18", "14:00", "Europe/Moscow"), "2026-11-18T11:00:00.000Z");
});

test("секунды во времени шаблона игнорируются", () => {
  assert.equal(instantInZone("2026-11-18", "14:00:00", "Europe/Moscow"), "2026-11-18T11:00:00.000Z");
});

test("летнее время учитывается", () => {
  assert.equal(instantInZone("2026-07-01", "12:00", "Europe/Berlin"), "2026-07-01T10:00:00.000Z");
  assert.equal(instantInZone("2026-01-01", "12:00", "Europe/Berlin"), "2026-01-01T11:00:00.000Z");
});

test("пустая дата или время — null, без исключения", () => {
  assert.equal(instantInZone("", "14:00", "Europe/Moscow"), null);
  assert.equal(instantInZone("2026-11-18", "", "Europe/Moscow"), null);
});
