import test from "node:test";
import assert from "node:assert/strict";
import { attendanceDecisionBlock, attendanceReviewRows, needsAttendanceReview, type AttendanceReviewInput } from "./attendance-review-rows.ts";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const shift = (id: string, starts: string, ends: string) => ({
  id,
  published: true,
  user_id: "u1",
  title: "Бармен",
  starts_at: starts,
  ends_at: ends,
}) as unknown as AttendanceReviewInput["plannedShifts"][number];
const base = (over: Partial<AttendanceReviewInput> = {}): AttendanceReviewInput => ({
  attendance: [],
  plannedShifts: [],
  sources: [],
  scheduleReviews: [],
  employees: [],
  timezone: "Europe/Moscow",
  dayStartHour: 9,
  ...over,
});
const pending = (input: AttendanceReviewInput, month = "2026-11") =>
  attendanceReviewRows(input, month, undefined, NOW).filter(needsAttendanceReview);

test("смена без отметки в проверенном дне ждёт решения", () => {
  const input = base({
    plannedShifts: [shift("s1", "2026-11-17T10:00:00Z", "2026-11-17T20:00:00Z")],
    sources: [{ business_date: "2026-11-17", state: "complete", error: null, synced_at: "2026-11-18T01:00:00Z", missing_shifts: ["s1"] }],
  });
  assert.deepEqual(pending(input).map((r) => r.id), ["s1"]);
});

test("решение по смене снимает её с проверки сразу, до пересчёта дня", () => {
  const input = base({
    plannedShifts: [shift("s1", "2026-11-17T10:00:00Z", "2026-11-17T20:00:00Z")],
    sources: [{ business_date: "2026-11-17", state: "pending", error: null, synced_at: "2026-11-18T01:00:00Z", missing_shifts: ["s1"] }],
    scheduleReviews: [{
      id: "r1",
      shift_id: "s1",
      business_date: "2026-11-17",
      employee_id: null,
      decision: "include",
      reason: "Был на смене",
      snapshot: { user_id: "u1", starts_at: "2026-11-17T10:00:00Z", ends_at: "2026-11-17T20:00:00Z" },
    }],
  });
  assert.equal(pending(input).length, 0);
});

test("день без данных Quick Resto не считается невыходом", () => {
  const input = base({
    plannedShifts: [shift("s1", "2026-11-17T10:00:00Z", "2026-11-17T20:00:00Z")],
  });
  assert.equal(pending(input).length, 0);
});

test("отметка без графика ждёт решения, подтверждённая — нет; другой месяц не считается", () => {
  const mark = (id: string, date: string, status: "unplanned" | "confirmed") => ({
    id, business_date: date, external_id: 1, employee_id: null, starts_at: `${date}T10:00:00Z`,
    ends_at: `${date}T18:00:00Z`, shift_id: null, role_name: "Бармен", status, issue: null,
    reviewed_by: null, review_reason: null, version: 1,
  });
  const input = base({
    attendance: [mark("a1", "2026-11-12", "unplanned"), mark("a2", "2026-11-13", "confirmed"), mark("a3", "2026-10-30", "unplanned")],
  });
  assert.deepEqual(pending(input).map((r) => r.id), ["a1"]);
  assert.deepEqual(pending(input, "2026-10").map((r) => r.id), ["a3"]);
});

const complete = (date: string, missing: string[] = []) => ({
  business_date: date, state: "complete", error: null, synced_at: "2026-11-18T01:00:00Z", missing_shifts: missing,
}) as AttendanceReviewInput["sources"][number];
const review = (decision: "include" | "exclude" | null) => ({
  id: "r1", shift_id: "s1", business_date: "2026-11-17", employee_id: null, decision, reason: "Основание",
  snapshot: { user_id: "u1", starts_at: "2026-11-17T10:00:00Z", ends_at: "2026-11-17T20:00:00Z" },
});

test("засчитанная по графику смена — выход, а не невыход", () => {
  const input = base({
    plannedShifts: [shift("s1", "2026-11-17T10:00:00Z", "2026-11-17T20:00:00Z")],
    sources: [complete("2026-11-17", ["s1"])],
    scheduleReviews: [review("include")],
  });
  const [row] = attendanceReviewRows(input, "2026-11", undefined, NOW);
  assert.equal(row.status, "confirmed");
  assert.equal(row.noShow, false);
  const [noShow] = attendanceReviewRows({ ...input, scheduleReviews: [review(null)] }, "2026-11", undefined, NOW);
  assert.equal(noShow.status, "ignored");
  assert.equal(noShow.noShow, true);
});

test("решение доступно по строке: открытая отметка — только «не учитывать», несвязанная — никакое", () => {
  const mark = (over: Record<string, unknown>) => ({
    id: "a1", business_date: "2026-11-12", external_id: 1, employee_id: "e1", starts_at: "2026-11-12T10:00:00Z",
    ends_at: "2026-11-12T18:00:00Z", shift_id: null, role_name: "Бармен", status: "unplanned", issue: null,
    reviewed_by: null, review_reason: null, version: 1, ...over,
  }) as unknown as AttendanceReviewInput["attendance"][number];
  const ctx = { canReviewSchedule: true };
  const row = (over: Record<string, unknown>) =>
    attendanceReviewRows(base({ attendance: [mark(over)] }), "2026-11", undefined, NOW)[0];
  assert.equal(attendanceDecisionBlock(row({}), "confirm", ctx), null);
  assert.equal(attendanceDecisionBlock(row({}), "ignore", ctx), null);
  const open = row({ status: "open", ends_at: null });
  assert.notEqual(attendanceDecisionBlock(open, "confirm", ctx), null);
  assert.equal(attendanceDecisionBlock(open, "ignore", ctx), null);
  const unlinked = row({ status: "unlinked", employee_id: null });
  assert.notEqual(attendanceDecisionBlock(unlinked, "confirm", ctx), null);
  assert.notEqual(attendanceDecisionBlock(unlinked, "ignore", ctx), null);
});

test("смену без отметки засчитывают только с правом на всё расписание", () => {
  const input = base({
    plannedShifts: [shift("s1", "2026-11-17T10:00:00Z", "2026-11-17T20:00:00Z")],
    sources: [complete("2026-11-17", ["s1"])],
  });
  const [row] = attendanceReviewRows(input, "2026-11", undefined, NOW);
  assert.equal(attendanceDecisionBlock(row, "confirm", { canReviewSchedule: true }), null);
  assert.notEqual(attendanceDecisionBlock(row, "confirm", { canReviewSchedule: false }), null);
  assert.equal(attendanceDecisionBlock(row, "ignore", { canReviewSchedule: false }), null);
});
