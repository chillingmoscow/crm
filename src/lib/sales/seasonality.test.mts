import test from "node:test";
import assert from "node:assert/strict";
import { INDUSTRY_SEASONALITY, ownSeasonIndex, parseSeasonIndex } from "./seasonality.ts";

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

test("отраслевая сезонность: 12 положительных индексов со средним 1", () => {
  assert.equal(INDUSTRY_SEASONALITY.index.length, 12);
  assert.ok(INDUSTRY_SEASONALITY.index.every((v) => v > 0));
  assert.ok(Math.abs(mean(INDUSTRY_SEASONALITY.index) - 1) < 0.001);
  assert.ok(INDUSTRY_SEASONALITY.source.length > 0);
});

test("parseSeasonIndex: отклоняет неверное, нормирует к среднему 1", () => {
  assert.throws(() => parseSeasonIndex(Array(11).fill(1)), /12/);
  assert.throws(() => parseSeasonIndex([...Array(11).fill(1), 0]), /положительн/);
  assert.throws(() => parseSeasonIndex([...Array(11).fill(1), -1]), /положительн/);
  assert.throws(() => parseSeasonIndex("1,1"), /12/);
  assert.deepEqual(parseSeasonIndex(Array(12).fill(2)), Array(12).fill(1));
});

test("ownSeasonIndex: удвоенный декабрь виден, месяцы без года — null", () => {
  const days: { date: string; turnover: number }[] = [];
  for (let d = new Date(Date.UTC(2025, 11, 1)); d < new Date(Date.UTC(2027, 0, 1)); d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    days.push({ date, turnover: date.slice(5, 7) === "12" ? 200 : 100 });
  }
  const idx = ownSeasonIndex(days);
  assert.equal(idx.length, 12);
  assert.ok(Math.abs(idx[11]! / idx[0]! - 2) < 0.001);
  assert.ok(Math.abs(mean(idx as number[]) - 1) < 0.001);
  assert.deepEqual(ownSeasonIndex(days.filter((d) => d.date >= "2026-06-01")), Array(12).fill(null));
});
