import test from "node:test";
import assert from "node:assert/strict";

import {
  canRequestSwap,
  swapActions,
  swapCandidates,
  swapDisplayStatus,
  swapProblem,
  type SwapContext,
} from "./shift-swaps.ts";

const tz = "Europe/Moscow";
const BAR = "role-bar";
const KITCHEN = "role-kitchen";
// 21.11, 10:00–22:00 по Москве.
const shift = {
  id: "s1",
  user_id: "hamlet",
  role_id: BAR,
  starts_at: "2026-11-21T07:00:00Z",
  ends_at: "2026-11-21T19:00:00Z",
  published: true,
};
const people = [
  { user_id: "hamlet", role_ids: [BAR], name: "Гамлет" },
  { user_id: "kristina", role_ids: [BAR], name: "Кристина" },
  { user_id: "cook", role_ids: [KITCHEN], name: "Повар" },
  { user_id: "trained", role_ids: [KITCHEN], name: "С допуском" },
  { user_id: "busy", role_ids: [BAR], name: "Занят днём" },
  { user_id: "evening", role_ids: [BAR], name: "Вечер того же дня" },
  { user_id: "night", role_ids: [BAR], name: "Ночь накануне" },
];
const ctx: SwapContext = {
  timezone: tz,
  qualifications: [{ user_id: "trained", role_id: BAR }],
  busy: [
    { id: "s1", user_id: "hamlet", starts_at: shift.starts_at, ends_at: shift.ends_at },
    { id: "b1", user_id: "busy", starts_at: "2026-11-21T09:00:00Z", ends_at: "2026-11-21T12:00:00Z" },
    // 23:00–02:00 по Москве того же дня — пересечения нет, но день занят.
    { id: "b2", user_id: "evening", starts_at: "2026-11-21T20:00:00Z", ends_at: "2026-11-21T23:00:00Z" },
    // Ночная смена накануне (20.11, 22:00 — 21.11, 06:00): другой день, без пересечения.
    { id: "b3", user_id: "night", starts_at: "2026-11-20T19:00:00Z", ends_at: "2026-11-21T03:00:00Z" },
  ],
};

test("кандидаты: та же должность или допуск, свободны в этот день", () => {
  assert.deepEqual(
    swapCandidates(shift, people, ctx).map((p) => p.user_id),
    ["kristina", "trained", "night"],
  );
});

test("причины, по которым сотрудник не подходит", () => {
  const find = (id: string) => people.find((p) => p.user_id === id);
  assert.equal(swapProblem(shift, find("hamlet"), ctx), "Сотрудник уже стоит на этой смене");
  assert.equal(swapProblem(shift, find("cook"), ctx), "У сотрудника нет допуска к этой позиции");
  assert.equal(swapProblem(shift, find("busy"), ctx), "У сотрудника уже есть смена в этот день");
  assert.equal(swapProblem(shift, find("evening"), ctx), "У сотрудника уже есть смена в этот день");
  assert.equal(swapProblem(shift, undefined, ctx), "Сотрудник не работает в заведении");
});

test("смена без должности — подходит любой свободный сотрудник", () => {
  const open = { ...shift, role_id: null };
  assert.ok(swapCandidates(open, people, ctx).some((p) => p.user_id === "cook"));
});

test("пересечение по времени ловится и через полночь", () => {
  const late = { ...shift, starts_at: "2026-11-21T18:00:00Z", ends_at: "2026-11-22T01:00:00Z" };
  const other = { ...ctx, busy: [{ id: "x", user_id: "kristina", starts_at: "2026-11-21T23:00:00Z", ends_at: "2026-11-22T02:00:00Z" }] };
  assert.equal(
    swapProblem(late, people[1], other),
    "У сотрудника уже есть смена в этот день",
  );
});

const now = Date.parse("2026-11-20T12:00:00Z");
const pending = { status: "pending" as const, from_user_id: "hamlet", to_user_id: "kristina" };

test("действия по заявке: автор отзывает, коллега отвечает, управляющий решает", () => {
  assert.deepEqual(swapActions(pending, shift, { userId: "hamlet", canDecide: false }, now), ["cancel"]);
  assert.deepEqual(swapActions(pending, shift, { userId: "kristina", canDecide: false }, now), ["respond"]);
  assert.deepEqual(swapActions(pending, shift, { userId: "boss", canDecide: true }, now), ["approve", "reject"]);
  assert.deepEqual(swapActions(pending, shift, { userId: "other", canDecide: false }, now), []);
});

test("после решения действий нет", () => {
  for (const status of ["approved", "rejected", "cancelled", "voided"] as const)
    assert.deepEqual(
      swapActions({ ...pending, status }, shift, { userId: "boss", canDecide: true }, now),
      [],
    );
});

test("заявка по закончившейся смене — «Истекла», решать её уже нельзя", () => {
  const after = Date.parse("2026-11-21T19:00:00Z");
  assert.equal(swapDisplayStatus(pending, shift, after), "expired");
  assert.equal(swapDisplayStatus(pending, shift, now), "pending");
  assert.equal(swapDisplayStatus({ status: "approved" }, shift, after), "approved");
  assert.deepEqual(swapActions(pending, shift, { userId: "boss", canDecide: true }, after), []);
});

test("предложить замену можно только для своей будущей опубликованной смены", () => {
  assert.equal(canRequestSwap(shift, "hamlet", false, now), true);
  assert.equal(canRequestSwap(shift, "kristina", false, now), false);
  assert.equal(canRequestSwap(shift, "hamlet", true, now), false);
  assert.equal(canRequestSwap({ ...shift, published: false }, "hamlet", false, now), false);
  assert.equal(canRequestSwap(shift, "hamlet", false, Date.parse(shift.starts_at)), false);
});
