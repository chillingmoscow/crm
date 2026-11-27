import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByTimeBucket } from "./group-by-time.ts";

const at = (iso: string) => ({ created_at: iso });

test("границы дня — в поясе заведения, а не устройства или сервера", () => {
  // 27.11 00:30 МСК = 26.11 21:30 UTC.
  const now = new Date("2026-11-27T09:00:00Z");
  const items = [at("2026-11-26T21:30:00Z"), at("2026-11-26T20:30:00Z")];
  const moscow = groupByTimeBucket(items, now, "Europe/Moscow");
  assert.deepEqual(moscow.get("today"), [items[0]]);
  assert.deepEqual(moscow.get("this_week"), [items[1]]);
  const utc = groupByTimeBucket(items, now, "UTC");
  assert.equal(utc.has("today"), false);
});

test("неделя — с понедельника, прошлая неделя и раньше", () => {
  // Пятница 27.11.2026; понедельник — 23.11.
  const now = new Date("2026-11-27T09:00:00Z");
  const items = [
    at("2026-11-23T06:00:00Z"),
    at("2026-11-22T06:00:00Z"),
    at("2026-11-16T06:00:00Z"),
    at("2026-11-15T06:00:00Z"),
  ];
  const groups = groupByTimeBucket(items, now, "Europe/Moscow");
  assert.deepEqual(groups.get("this_week"), [items[0]]);
  assert.deepEqual(groups.get("last_week"), [items[1], items[2]]);
  assert.deepEqual(groups.get("older"), [items[3]]);
});
