import test from "node:test";
import assert from "node:assert/strict";

import {
  dailyScheduleLabel,
  daysLabel,
  reminderScheduleLabel,
  scheduleReminderText,
} from "./task-message-schedule.ts";

test("дни: все, будни, выходные, выборочно", () => {
  assert.equal(daysLabel([1, 2, 3, 4, 5, 6, 7]), "Каждый день");
  assert.equal(daysLabel([5, 4, 3, 2, 1]), "По будням");
  assert.equal(daysLabel([7, 6]), "По выходным");
  assert.equal(daysLabel([5, 1, 3]), "ПН, СР, ПТ");
  assert.equal(daysLabel([]), null);
  assert.equal(daysLabel([0, 8]), null);
});

test("подпись списка задач — с временем без секунд", () => {
  assert.equal(dailyScheduleLabel([1, 2, 3, 4, 5, 6, 7], "12:00:00"), "Каждый день в 12:00");
  assert.equal(dailyScheduleLabel([], "12:00"), null);
});

test("подпись напоминания", () => {
  assert.equal(
    reminderScheduleLabel(1, 3, "14:00:00"),
    "В понедельник в 14:00 — начать сбор, в среду в 14:00 — последний день",
  );
  assert.equal(reminderScheduleLabel(2, 2, "14:00"), null);
});

test("текст напоминания называет выбранный последний день", () => {
  assert.match(scheduleReminderText("schedule_open", 5, "L"), /до пятницы включительно/);
  assert.match(scheduleReminderText("monday", null, "L"), /до среды включительно/);
  assert.match(scheduleReminderText("schedule_deadline", 5, "L"), /Сегодня последний день/);
  assert.match(scheduleReminderText("wednesday", null, "L"), /L$/);
});
