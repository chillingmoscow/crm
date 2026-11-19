import test from "node:test";
import assert from "node:assert/strict";

import { overdueHint, stageAge, stageAgeDays } from "./stage-age.ts";

const now = new Date("2026-11-19T10:00:00+03:00");

test("stageAgeDays: counts Moscow calendar days, not 24-hour periods", () => {
  // 23:30 по Москве накануне — уже вчера, хотя прошло меньше суток.
  assert.equal(stageAgeDays("2026-11-18T23:30:00+03:00", now), 1);
  assert.equal(stageAgeDays("2026-11-19T00:10:00+03:00", now), 0);
  // 22:00 UTC 18 ноября — это 01:00 19 ноября по Москве.
  assert.equal(stageAgeDays("2026-11-18T22:00:00Z", now), 0);
  assert.equal(stageAgeDays("2026-11-10T12:00:00+03:00", now), 9);
});

test("stageAgeDays: future or invalid dates do not go negative", () => {
  assert.equal(stageAgeDays("2026-11-25T12:00:00+03:00", now), 0);
  assert.equal(stageAgeDays("not a date", now), 0);
});

test("stageAge: labels today and plural days (number joined by a no-break space)", () => {
  assert.equal(stageAge("new", "2026-11-19T08:00:00+03:00", now)?.label, "Сегодня");
  assert.equal(stageAge("trial", "2026-11-18T08:00:00+03:00", now)?.label, "1\u00a0день");
  assert.equal(stageAge("trial", "2026-11-16T08:00:00+03:00", now)?.label, "3\u00a0дня");
  assert.equal(stageAge("trial", "2026-11-07T08:00:00+03:00", now)?.label, "12\u00a0дней");
});

test("stageAge: highlights only past the stage limit", () => {
  // Новая анкета: порог 2 дня.
  assert.equal(stageAge("new", "2026-11-17T12:00:00+03:00", now)?.overdueAfter, null);
  assert.equal(stageAge("new", "2026-11-16T12:00:00+03:00", now)?.overdueAfter, 2);
  // Стажировка: 10 дней — ещё в норме, 15 — уже нет.
  assert.equal(stageAge("trial", "2026-11-09T12:00:00+03:00", now)?.overdueAfter, null);
  assert.equal(stageAge("trial", "2026-11-04T12:00:00+03:00", now)?.overdueAfter, 14);
});

test("stageAge: rejected and hired have no stage age", () => {
  assert.equal(stageAge("rejected", "2026-10-01T12:00:00+03:00", now), null);
  assert.equal(stageAge("hired", "2026-10-01T12:00:00+03:00", now), null);
});

test("overdueHint: genitive after «дольше»", () => {
  assert.equal(overdueHint(2, "Новая анкета"), "Дольше 2 дней на этапе «Новая анкета»");
  assert.equal(overdueHint(14, "Стажировка"), "Дольше 14 дней на этапе «Стажировка»");
  assert.equal(overdueHint(21, "Стажировка"), "Дольше 21 дня на этапе «Стажировка»");
});
