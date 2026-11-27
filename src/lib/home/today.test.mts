import assert from "node:assert/strict";
import test from "node:test";

import { greetingFor, relativeDayLabel, weekCelebrations, weekOf } from "./today.ts";

test("greetingFor: время суток", () => {
  assert.equal(greetingFor(4), "Доброй ночи");
  assert.equal(greetingFor(5), "Доброе утро");
  assert.equal(greetingFor(11), "Доброе утро");
  assert.equal(greetingFor(12), "Добрый день");
  assert.equal(greetingFor(18), "Добрый вечер");
  assert.equal(greetingFor(23), "Доброй ночи");
  assert.equal(greetingFor(0), "Доброй ночи");
});

test("weekOf: понедельник–воскресенье", () => {
  assert.deepEqual(weekOf("2026-11-27"), { from: "2026-11-23", to: "2026-11-29" });
  assert.deepEqual(weekOf("2026-11-23"), { from: "2026-11-23", to: "2026-11-29" });
  // Воскресенье — последний день своей недели, а не первый следующей.
  assert.deepEqual(weekOf("2026-11-29"), { from: "2026-11-23", to: "2026-11-29" });
  assert.deepEqual(weekOf("2027-01-01"), { from: "2026-12-28", to: "2027-01-03" });
});

const person = (over: Partial<Parameters<typeof weekCelebrations>[0][number]>) => ({
  userId: "u",
  name: "Анна",
  avatarUrl: null,
  role: null,
  birthDate: null,
  employmentDate: null,
  ...over,
});

test("weekCelebrations: день рождения и годовщина на неделе", () => {
  const week = weekOf("2026-11-27");
  const list = weekCelebrations(
    [
      person({ userId: "a", name: "Анна", birthDate: "1995-11-28" }),
      person({ userId: "b", name: "Борис", employmentDate: "2023-11-24" }),
      person({ userId: "c", name: "Вера", birthDate: "1990-12-01", employmentDate: "2026-11-25" }),
    ],
    week,
  );
  assert.deepEqual(
    list.map((c) => [c.userId, c.kind, c.date, c.years]),
    [
      ["b", "anniversary", "2026-11-24", 3],
      ["a", "birthday", "2026-11-28", 31],
    ],
  );
});

test("weekCelebrations: неделя на стыке лет", () => {
  const week = weekOf("2026-12-30");
  const list = weekCelebrations(
    [
      person({ userId: "a", birthDate: "2000-01-02" }),
      person({ userId: "b", birthDate: "2000-12-29" }),
    ],
    week,
  );
  assert.deepEqual(list.map((c) => [c.userId, c.date, c.years]), [
    ["b", "2026-12-29", 26],
    ["a", "2027-01-02", 27],
  ]);
});

test("weekCelebrations: 29 февраля в невисокосный год — 28-е", () => {
  const list = weekCelebrations([person({ birthDate: "2000-02-29" })], weekOf("2027-02-28"));
  assert.equal(list[0]?.date, "2027-02-28");
});

test("relativeDayLabel", () => {
  assert.equal(relativeDayLabel("2026-11-27", "2026-11-27"), "Сегодня");
  assert.equal(relativeDayLabel("2026-11-28", "2026-11-27"), "Завтра");
  assert.equal(relativeDayLabel("2026-11-26", "2026-11-27"), "Вчера");
  assert.equal(relativeDayLabel("2026-11-29", "2026-11-27"), null);
});
