import { test } from "node:test";
import assert from "node:assert/strict";
import { followScheduleDays, type FollowRow } from "./payout-follow.ts";

const WINDOW = { from: "2026-11-25", to: "2026-12-01" };
const TODAY = "2026-11-27";
const row = (extra: Partial<FollowRow> = {}): FollowRow => ({
  id: "r1",
  employee_id: "e1",
  pay_date: "2026-11-28",
  pay_date_manual: false,
  amount: 5000,
  issued: 0,
  state: "planned",
  ...extra,
});
const shifts = (...days: string[]) => days.map((business_date) => ({ employee_id: "e1", business_date }));
const follow = (r: FollowRow, s = shifts()) => followScheduleDays([r], s, TODAY, WINDOW);

test("день по графику на смене — остаётся", () => {
  assert.deepEqual(follow(row(), shifts("2026-11-28", "2026-11-30")), []);
});

test("без дня: появилась смена — день на неё", () => {
  assert.deepEqual(follow(row({ pay_date: null }), shifts("2026-11-28")), [
    { row_id: "r1", employee_id: "e1", from: null, to: "2026-11-28" },
  ]);
});

test("замена: в свой день не на смене — на ближайшую смену в окне", () => {
  assert.deepEqual(follow(row(), shifts("2026-11-30")), [
    { row_id: "r1", employee_id: "e1", from: "2026-11-28", to: "2026-11-30" },
  ]);
});

test("замена: смен в окне больше нет — без дня, чтобы не выдать тому, кого нет", () => {
  assert.deepEqual(follow(row(), shifts("2026-11-26")), [
    { row_id: "r1", employee_id: "e1", from: "2026-11-28", to: null },
  ]);
});

test("пропущено: прошедший день — на ближайшую смену с сегодняшнего", () => {
  assert.deepEqual(follow(row({ pay_date: "2026-11-26" }), shifts("2026-11-26", "2026-11-27")), [
    { row_id: "r1", employee_id: "e1", from: "2026-11-26", to: "2026-11-27" },
  ]);
});

test("пропущено и смен впереди нет — остаётся «Пропущено»", () => {
  assert.deepEqual(follow(row({ pay_date: "2026-11-26" }), shifts("2026-11-26")), []);
});

test("ручной день не трогаем, даже без смены", () => {
  assert.deepEqual(follow(row({ pay_date_manual: true }), shifts("2026-11-30")), []);
  assert.deepEqual(follow(row({ pay_date: "2026-11-26", pay_date_manual: true }), shifts("2026-11-30")), []);
});

test("выданное и нулевые строки не трогаем", () => {
  assert.deepEqual(follow(row({ state: "issued", issued: 5000 }), shifts("2026-11-30")), []);
  assert.deepEqual(follow(row({ amount: 0 }), shifts("2026-11-30")), []);
  assert.deepEqual(follow(row({ issued: 5000, state: "partial" }), shifts("2026-11-30")), []);
});

test("частично выданная строка с остатком тоже следует за графиком", () => {
  assert.deepEqual(follow(row({ issued: 2000, state: "partial" }), shifts("2026-11-29")), [
    { row_id: "r1", employee_id: "e1", from: "2026-11-28", to: "2026-11-29" },
  ]);
});

test("смены вне окна и чужие смены не считаются", () => {
  const other = [{ employee_id: "e2", business_date: "2026-11-28" }];
  assert.deepEqual(follow(row({ pay_date: null }), [...shifts("2026-12-02"), ...other]), []);
});

test("окно ещё не началось — ближайшая смена с начала окна", () => {
  const r = followScheduleDays([row({ pay_date: null })], shifts("2026-11-24", "2026-11-26"), "2026-11-20", WINDOW);
  assert.deepEqual(r, [{ row_id: "r1", employee_id: "e1", from: null, to: "2026-11-26" }]);
});
