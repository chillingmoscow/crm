import test from "node:test";
import assert from "node:assert/strict";

import { CASUAL_RECENT_DAYS, splitCasualEmployees } from "./casual-recency.ts";

const employees = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

test("разовый с недавней или будущей сменой остаётся в списке", () => {
  const { recent, former } = splitCasualEmployees({
    employees,
    today: "2026-11-17",
    shiftDates: [
      { employeeId: "a", date: "2026-11-10" },
      { employeeId: "b", date: "2026-12-01" },
      { employeeId: "c", date: "2026-08-01" },
    ],
  });
  assert.deepEqual(recent.map((e) => e.id), ["a", "b"]);
  assert.deepEqual(former.map((e) => e.id), ["c", "d"]);
});

test("граница — ровно CASUAL_RECENT_DAYS дней назад ещё актуальна", () => {
  assert.equal(CASUAL_RECENT_DAYS, 30);
  const { recent } = splitCasualEmployees({
    employees,
    today: "2026-11-17",
    shiftDates: [
      { employeeId: "a", date: "2026-10-18" },
      { employeeId: "b", date: "2026-10-17" },
    ],
  });
  assert.deepEqual(recent.map((e) => e.id), ["a"]);
});

test("выбранный сейчас сотрудник не прячется", () => {
  const { recent, former } = splitCasualEmployees({
    employees,
    today: "2026-11-17",
    shiftDates: [],
    keep: ["d"],
  });
  assert.deepEqual(recent.map((e) => e.id), ["d"]);
  assert.equal(former.length, 3);
});
