import assert from "node:assert/strict";
import test from "node:test";

import { defaultRecountMode, isoDay, recountGapDays } from "./recount-split.ts";

test("акт сегодняшний → пересчитываем в нём же", () => {
  assert.equal(defaultRecountMode("2026-08-26T09:00:00.000Z", "2026-08-26"), "inplace");
});

test("акт вчерашний → предлагаем отдельный акт пересчёта", () => {
  assert.equal(defaultRecountMode("2026-08-24T09:00:00.000Z", "2026-08-26"), "split");
});

test("дата акта неизвестна → безопасный вариант «отдельный акт»", () => {
  assert.equal(defaultRecountMode(null, "2026-08-26"), "split");
  assert.equal(defaultRecountMode("", "2026-08-26"), "split");
  assert.equal(defaultRecountMode("мусор", "2026-08-26"), "split");
});

test("isoDay вытаскивает день и отбрасывает мусор", () => {
  assert.equal(isoDay("2026-08-18T11:00:00.000Z"), "2026-08-18");
  assert.equal(isoDay("2026-08-18"), "2026-08-18");
  assert.equal(isoDay(null), null);
  assert.equal(isoDay("18.08.2026"), null);
});

test("разрыв в сутках считается по календарным дням", () => {
  // Реальный случай СВ340: подсчёт 18.08, пересчёт 19.08.
  assert.equal(recountGapDays("2026-08-18T11:00:00.000Z", "2026-08-19"), 1);
  // СВ324: пересчёт через пять дней.
  assert.equal(recountGapDays("2026-07-07T09:00:00.000Z", "2026-07-12"), 5);
  assert.equal(recountGapDays("2026-08-26T09:00:00.000Z", "2026-08-26"), 0);
  assert.equal(recountGapDays(null, "2026-08-26"), null);
});
