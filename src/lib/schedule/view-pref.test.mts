import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSchedulePrefs, schedulePrefCookieName, schedulePrefStorageKey } from "./view-pref.ts";

const venue = "5096c1b7-7d7c-496d-92fd-a5f9fa27c5a6";
const user = "543be73d-b7a5-4169-838a-ad0ea70dfba6";

test("ключ localStorage прежний — выбор, сделанный раньше, не теряется", () => {
  assert.equal(schedulePrefStorageKey("view", venue, user), `schedule.view.${venue}.${user}`);
  assert.equal(schedulePrefStorageKey("tasks", venue, user), `schedule.tasks.${venue}.${user}`);
  assert.equal(schedulePrefStorageKey("templateSort", venue, user), `schedule.templateSort.${venue}.${user}`);
});

test("имя cookie — только буквы, цифры и подчёркивания", () => {
  const name = schedulePrefCookieName("templateSort", venue, user);
  assert.match(name, /^sheerly_schedule_templateSort_[a-zA-Z0-9_]+$/);
  assert.notEqual(name, schedulePrefCookieName("templateSort", venue, "other"));
});

test("значения cookie: годное читается, мусор и пустота — не задано", () => {
  assert.deepEqual(parseSchedulePrefs({ view: "list", tasks: "false", templateSort: "name" }), {
    view: "list",
    showTasks: false,
    templateSort: "name",
  });
  assert.deepEqual(parseSchedulePrefs({ tasks: "true" }), { showTasks: true });
  assert.deepEqual(parseSchedulePrefs({ view: "month", tasks: "1", templateSort: undefined }), {});
});
