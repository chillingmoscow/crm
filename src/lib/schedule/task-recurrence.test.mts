import test from "node:test";
import assert from "node:assert/strict";

import { taskRecurrenceLabel } from "./task-recurrence.ts";

// 2026-11-17 — вторник, 2026-11-18 — среда, 2026-11-22 — воскресенье.
test("каждую неделю — день недели якоря", () => {
  assert.equal(taskRecurrenceLabel({ unit: "week", interval: 1, anchor: "2026-11-17" }), "Каждый вторник");
  assert.equal(taskRecurrenceLabel({ unit: "week", interval: 1, anchor: "2026-11-18" }), "Каждую среду");
  assert.equal(taskRecurrenceLabel({ unit: "week", interval: 1, anchor: "2026-11-22" }), "Каждое воскресенье");
});

test("раз в N недель — с днём", () => {
  assert.equal(taskRecurrenceLabel({ unit: "week", interval: 2, anchor: "2026-11-17" }), "Раз в 2 недели · по вторникам");
  assert.equal(taskRecurrenceLabel({ unit: "week", interval: 5, anchor: "2026-11-18" }), "Раз в 5 недель · по средам");
});

test("месяцы — с числом", () => {
  assert.equal(taskRecurrenceLabel({ unit: "month", interval: 1, anchor: "2026-11-15" }), "Каждый месяц · 15-го");
  assert.equal(taskRecurrenceLabel({ unit: "month", interval: 3, anchor: "2026-11-01" }), "Раз в 3 месяца · 1-го");
});

test("без повтора — null", () => {
  assert.equal(taskRecurrenceLabel(null), null);
  assert.equal(taskRecurrenceLabel({ unit: "week", interval: 0, anchor: "2026-11-17" }), null);
});
