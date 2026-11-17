import { test } from "node:test";
import assert from "node:assert/strict";
import { applyScheduleReviews, reconcileAttendance } from "./attendance.ts";
import type { PayEmployee } from "./types.ts";
import type { Shift } from "../schedule/types.ts";

const date = "2026-11-10", tz = "Europe/Moscow", hour = 6;
const employee = (patch: Partial<PayEmployee>): PayEmployee => ({
  id: "e", account_id: "a", venue_id: "v", quickresto_id: null, name: "Кристина Мелконян",
  local_user_id: null, role_name: "Хостес", model_id: "m", hired_on: null, experience_offset_months: 0,
  casual: false, attendance_source: "quickresto", active: true, opening_balance: 0, opening_confirmed: true,
  ...patch,
});
const shift = (patch: Partial<Shift>) => ({
  id: "s", venue_id: "v", user_id: null, payroll_employee_id: null, payroll_model_id: "m",
  published: true, starts_at: "2026-11-10T09:00:00.000Z", ends_at: "2026-11-10T17:00:00.000Z",
  payroll_fact_id: -7, version: 1, role_id: "r", ...patch,
}) as unknown as Shift;
const mark = (owner: number) => ({
  id: 501, owner: { id: owner },
  startTime: Date.parse("2026-11-10T09:12:00.000Z"), endTime: Date.parse("2026-11-10T17:05:00.000Z"),
});
const run = (rows: ReturnType<typeof mark>[], people: PayEmployee[], shifts: Shift[], fallbackFrom: string | null = null) =>
  applyScheduleReviews(reconcileAttendance(rows, people, shifts, date, tz, hour), shifts, [], date, fallbackFrom);

test("casual with a Quick Resto code: the mark is the fact, no schedule credit on top", () => {
  const casual = employee({ id: "c", casual: true, quickresto_id: 77 });
  const result = run([mark(77)], [casual], [shift({ payroll_employee_id: "c" })]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].external_id, 501);
  assert.equal(result.items[0].employee_id, "c");
  assert.equal(result.items[0].shift_id, "s");
  assert.equal(result.items[0].status, "confirmed");
  assert.equal(result.items[0].starts_at, "2026-11-10T09:12:00.000Z");
  assert.deepEqual(result.missing, []);
});

test("casual with a Quick Resto code and no mark: credited by the schedule without fallback setting", () => {
  const casual = employee({ id: "c", casual: true, quickresto_id: 77 });
  const result = run([], [casual], [shift({ payroll_employee_id: "c" })]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].external_id, -7);
  assert.equal(result.items[0].status, "confirmed");
  assert.equal(result.marks.s.state, "scheduled");
  assert.deepEqual(result.missing, []);
});

test("casual without a Quick Resto code keeps schedule-only credit", () => {
  const casual = employee({ id: "c", casual: true });
  const result = run([], [casual], [shift({ payroll_employee_id: "c" })]);
  assert.deepEqual(result.items.map((item) => item.external_id), [-7]);
});

test("a staff code mark is not attributed to the casual worker on the same shift", () => {
  const staff = employee({ id: "p", name: "Александр Павлов", quickresto_id: 10, local_user_id: "u" });
  const casual = employee({ id: "c", casual: true, quickresto_id: 77 });
  const staffMark = { ...mark(10), id: 502 };
  const result = run([mark(77), staffMark], [staff, casual], [shift({ payroll_employee_id: "c" })]);
  assert.deepEqual(result.items.map((item) => [item.employee_id, item.external_id, item.shift_id, item.status]), [
    ["c", 501, "s", "confirmed"],
    ["p", 502, null, "unplanned"],
  ]);
});

test("staff without a mark still waits for review when fallback is off", () => {
  const staff = employee({ id: "p", quickresto_id: 10, local_user_id: "u" });
  const result = run([], [staff], [shift({ user_id: "u" })]);
  assert.equal(result.items.length, 0);
  assert.equal(result.missing.length, 1);
  assert.equal(result.marks.s.state, "missing");
});
