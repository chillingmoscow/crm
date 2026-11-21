import assert from "node:assert/strict";
import { test } from "node:test";

import {
  defaultScheduleFromDate,
  describeSchedule,
  overdueDays,
  scheduleFromTemplate,
} from "./recurring-schedule.ts";

test("describeSchedule: месяц", () => {
  assert.equal(describeSchedule({ frequency: "monthly", dayOfMonth: 5 }), "каждый месяц 5-го");
  assert.equal(
    describeSchedule({ frequency: "monthly", dayOfMonth: 31 }),
    "каждый месяц в последний день",
  );
});

test("describeSchedule: неделя", () => {
  assert.equal(
    describeSchedule({ frequency: "weekly", weekday: 1 }),
    "каждую неделю по понедельникам",
  );
  assert.equal(describeSchedule({ frequency: "weekly", weekday: 3 }), "каждую неделю по средам");
  assert.equal(
    describeSchedule({ frequency: "weekly", weekday: 7 }),
    "каждую неделю по воскресеньям",
  );
});

test("describeSchedule: квартал", () => {
  assert.equal(
    describeSchedule({ frequency: "quarterly", quarterMonth: 1, dayOfMonth: 10 }),
    "каждый квартал 10-го в первом месяце",
  );
  assert.equal(
    describeSchedule({ frequency: "quarterly", quarterMonth: 2, dayOfMonth: 31 }),
    "каждый квартал в последний день во втором месяце",
  );
  assert.equal(
    describeSchedule({ frequency: "quarterly", quarterMonth: 3, dayOfMonth: 1 }),
    "каждый квартал 1-го в третьем месяце",
  );
});

test("overdueDays", () => {
  assert.equal(overdueDays("2026-12-05", "2026-12-07"), 2);
  assert.equal(overdueDays("2026-12-05", "2026-12-05"), 0);
  assert.equal(overdueDays("2026-12-05", "2026-12-01"), 0);
  assert.equal(overdueDays("2026-02-27", "2026-03-02"), 3);
  assert.equal(overdueDays("2026-10-24", "2026-10-26"), 2);
});

test("defaultScheduleFromDate", () => {
  assert.deepEqual(defaultScheduleFromDate("2026-11-05"), { frequency: "monthly", dayOfMonth: 5 });
  assert.deepEqual(defaultScheduleFromDate("2026-12-31"), { frequency: "monthly", dayOfMonth: 31 });
});

test("scheduleFromTemplate", () => {
  assert.deepEqual(
    scheduleFromTemplate({ frequency: "monthly", day_of_month: 5, weekday: null, quarter_month: null }),
    { frequency: "monthly", dayOfMonth: 5 },
  );
  assert.deepEqual(
    scheduleFromTemplate({ frequency: "weekly", day_of_month: null, weekday: 2, quarter_month: null }),
    { frequency: "weekly", weekday: 2 },
  );
  assert.deepEqual(
    scheduleFromTemplate({ frequency: "quarterly", day_of_month: 10, weekday: null, quarter_month: 2 }),
    { frequency: "quarterly", dayOfMonth: 10, quarterMonth: 2 },
  );
});
