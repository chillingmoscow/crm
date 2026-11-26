import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileAttendance } from "./attendance.ts";
import type { PayEmployee } from "./types.ts";
import type { Shift } from "../schedule/types.ts";

// Рабочий день 25.11 (Москва, начало дня в 6:00); смена 17:30–03:00.
const date = "2026-11-25", tz = "Europe/Moscow", hour = 6;
const staff: PayEmployee = {
  id: "e", account_id: "a", venue_id: "v", quickresto_id: 42, name: "Никита Волков",
  local_user_id: "u", role_name: "Мастер", model_id: "m", hired_on: null, experience_offset_months: 0,
  casual: false, attendance_source: "quickresto", active: true, opening_balance: 0, opening_confirmed: true,
} as PayEmployee;
const shift = (patch: Partial<Shift> = {}) => ({
  id: "s", venue_id: "v", user_id: "u", payroll_employee_id: null, payroll_model_id: null,
  published: true, starts_at: "2026-11-25T14:30:00.000Z", ends_at: "2026-11-26T00:00:00.000Z",
  payroll_fact_id: -7, version: 1, role_id: "r", ...patch,
}) as unknown as Shift;
const clock = (id: number, start: string, end: string) => ({
  id, owner: { id: 42 }, startTime: Date.parse(start), endTime: Date.parse(end),
});

test("a short mark before the shift on the same working day belongs to that shift", () => {
  // Пришёл раньше: открыл и закрыл личную смену в 16:46, смена с 17:30.
  const { items } = reconcileAttendance(
    [clock(1, "2026-11-25T13:46:13.000Z", "2026-11-25T13:46:19.000Z")], [staff], [shift()], date, tz, hour);
  assert.equal(items[0].shift_id, "s");
  assert.equal(items[0].status, "confirmed");
  assert.equal(items[0].issue, null);
});

test("a mark reopened after closing the shift belongs to the same shift", () => {
  // Закрыл в 03:26, понадобилось открыть ещё раз в 04:29 — тот же рабочий день.
  const { items } = reconcileAttendance([
    clock(1, "2026-11-25T10:02:00.000Z", "2026-11-26T00:26:00.000Z"),
    clock(2, "2026-11-26T01:29:55.000Z", "2026-11-26T01:30:08.000Z"),
  ], [staff], [shift()], date, tz, hour);
  assert.deepEqual(items.map((i) => [i.external_id, i.shift_id, i.status]), [[1, "s", "confirmed"], [2, "s", "confirmed"]]);
});

test("without a shift that working day the mark stays unplanned", () => {
  const { items } = reconcileAttendance(
    [clock(1, "2026-11-25T13:46:13.000Z", "2026-11-25T13:46:19.000Z")], [staff],
    [shift({ starts_at: "2026-11-26T14:30:00.000Z", ends_at: "2026-11-27T00:00:00.000Z" })], date, tz, hour);
  assert.equal(items[0].shift_id, null);
  assert.equal(items[0].status, "unplanned");
});

test("two shifts that working day and no overlap: the mark is not guessed", () => {
  const { items } = reconcileAttendance(
    [clock(1, "2026-11-25T08:00:00.000Z", "2026-11-25T08:00:05.000Z")], [staff],
    [shift(), shift({ id: "s2", starts_at: "2026-11-25T09:00:00.000Z", ends_at: "2026-11-25T12:00:00.000Z" })],
    date, tz, hour);
  assert.equal(items[0].shift_id, null);
  assert.equal(items[0].status, "unplanned");
});
