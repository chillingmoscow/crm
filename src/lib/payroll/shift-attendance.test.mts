import test from "node:test";
import assert from "node:assert/strict";
import { applyShiftReviews } from "./shift-attendance.ts";

const mark = (syncedAt: string | null) => ({
  date: "2026-11-17",
  syncedAt,
  sourceState: "complete",
  state: "missing" as const,
});

test("решение новее синхронизации дня видно сразу", () => {
  const result = applyShiftReviews({ a: mark("2026-11-18T10:00:00Z") }, [
    { shift_id: "a", decision: "include", reason: "Был на смене", reviewed_at: "2026-11-18T11:00:00Z" },
  ]);
  assert.equal(result.a.state, "included");
  assert.equal(result.a.reason, "Был на смене");
});

test("пересчитанная отметка важнее старого решения", () => {
  const result = applyShiftReviews({ a: mark("2026-11-18T12:00:00Z") }, [
    { shift_id: "a", decision: "exclude", reason: "Не был", reviewed_at: "2026-11-18T11:00:00Z" },
  ]);
  assert.equal(result.a.state, "missing");
});

test("решение без отметки и без выбора игнорируется", () => {
  const marks = { a: mark(null) };
  const result = applyShiftReviews(marks, [
    { shift_id: "b", decision: "include", reason: "x", reviewed_at: "2026-11-18T11:00:00Z" },
    { shift_id: "a", decision: null, reason: "x", reviewed_at: "2026-11-18T11:00:00Z" },
  ]);
  assert.deepEqual(result, marks);
});

test("исключение отмечается как не учтённая смена", () => {
  const result = applyShiftReviews({ a: mark(null) }, [
    { shift_id: "a", decision: "exclude", reason: "Не вышел", reviewed_at: "2026-11-18T11:00:00Z" },
  ]);
  assert.equal(result.a.state, "excluded");
});
