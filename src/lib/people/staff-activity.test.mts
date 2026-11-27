import test from "node:test";
import assert from "node:assert/strict";
import {
  fullMonthsBetween,
  heatLevel,
  heatmapStart,
  heatmapWeeks,
  hoursByDay,
  onShiftNow,
  tenureLabel,
} from "./staff-activity.ts";

const now = Date.parse("2026-11-27T15:00:00Z");
const shift = (user: string, from: string, to: string) => ({
  user_id: user,
  payroll_employee_id: null,
  starts_at: from,
  ends_at: to,
});

test("на смене: идёт опубликованная смена", () => {
  const r = onShiftNow(now, [shift("u1", "2026-11-27T09:00:00Z", "2026-11-27T21:00:00Z")], []);
  assert.deepEqual(r.userIds, ["u1"]);
});

test("на смене: смена закончилась или ещё не началась", () => {
  const r = onShiftNow(
    now,
    [
      shift("u1", "2026-11-27T03:00:00Z", "2026-11-27T15:00:00Z"),
      shift("u2", "2026-11-27T16:00:00Z", "2026-11-27T23:00:00Z"),
    ],
    [],
  );
  assert.deepEqual(r.userIds, []);
});

test("на смене: открытая отметка без графика — на смене, старая — нет", () => {
  const r = onShiftNow(now, [], [
    { employee_id: "e1", user_id: null, starts_at: "2026-11-27T10:00:00Z", ends_at: null },
    { employee_id: "e2", user_id: "u2", starts_at: "2026-11-26T10:00:00Z", ends_at: null },
  ]);
  assert.deepEqual(r.employeeIds, ["e1"]);
  assert.deepEqual(r.userIds, []);
});

test("на смене: ушёл раньше конца смены — не на смене, вернулся — снова на смене", () => {
  const shifts = [shift("u1", "2026-11-27T09:00:00Z", "2026-11-27T21:00:00Z")];
  const left = { employee_id: "e1", user_id: "u1", starts_at: "2026-11-27T09:00:00Z", ends_at: "2026-11-27T13:00:00Z" };
  assert.deepEqual(onShiftNow(now, shifts, [left]).userIds, []);
  const back = { employee_id: "e1", user_id: "u1", starts_at: "2026-11-27T14:00:00Z", ends_at: null };
  assert.deepEqual(onShiftNow(now, shifts, [left, back]).userIds, ["u1"]);
});

const tl = (from: string | null, to: string) => tenureLabel(from, to)?.replace(/\u00a0/g, " ") ?? null;

test("стаж: полные месяцы и подпись со склонением", () => {
  assert.equal(fullMonthsBetween("2025-05-20", "2026-11-19"), 17);
  assert.equal(fullMonthsBetween("2025-05-20", "2026-11-20"), 18);
  assert.equal(tl("2025-05-20", "2026-11-27"), "работает 1 год 6 мес");
  assert.equal(tl("2023-11-01", "2026-11-27"), "работает 3 года");
  assert.equal(tl("2020-01-01", "2026-11-27"), "работает 6 лет 10 мес");
  assert.equal(tl("2026-09-01", "2026-11-27"), "работает 2 мес");
  assert.equal(tl("2026-11-20", "2026-11-27"), "работает меньше месяца");
  assert.equal(tl("2026-12-01", "2026-11-27"), null);
  assert.equal(tl(null, "2026-11-27"), null);
});

test("тепловая карта: недели с понедельника, текущая неделя последняя", () => {
  // 27.11.2026 — пятница.
  const weeks = heatmapWeeks({ "2026-11-27": 12, "2026-11-23": 3.5 }, "2026-11-27");
  assert.equal(weeks.length, 53);
  const last = weeks[52];
  assert.equal(last[0].date, "2026-11-23");
  assert.equal(last[0].level, 1);
  assert.equal(last[4].date, "2026-11-27");
  assert.equal(last[4].level, 4);
  assert.equal(last[5].future, true);
  assert.equal(weeks[0][0].date, heatmapStart("2026-11-27"));
});

test("тепловая карта: уровни по часам", () => {
  assert.deepEqual([0, 2, 4, 7.9, 8, 10.9, 11].map(heatLevel), [0, 1, 2, 2, 3, 3, 4]);
});

test("часы по дням: отметки заменяют график за свой день", () => {
  assert.deepEqual(
    hoursByDay(
      [{ date: "2026-11-01", hours: 12 }, { date: "2026-11-02", hours: 8 }],
      [{ date: "2026-11-01", hours: 10.5 }],
    ),
    { "2026-11-01": 10.5, "2026-11-02": 8 },
  );
});
