import test from "node:test";
import assert from "node:assert/strict";

import { candidateTimeline, meetingWhen, timelineDate } from "./timeline.ts";
import type { CandidateEvent } from "./types.ts";

const ev = (id: string, at: string, kind: string, details: Record<string, unknown>, actor = "Павел Оплочко"): CandidateEvent => ({
  id, actor_id: "u", kind, details, created_at: at, actor_name: actor,
});
const status = (from: string, to: string) => ({ changes: { status: { old: from, new: to } } });
const meeting = (over: Record<string, unknown>) => ({
  kind: "interview", appointment_date: "2026-11-21", starts_at: "2026-11-21T11:00:00Z",
  timezone: "Europe/Moscow", outcome: "scheduled", ...over,
});

test("timeline: submission, stage change, meeting with its stage change merged", () => {
  const items = candidateTimeline(
    { submitted_at: "2026-11-12T08:00:00Z", source: "tilda" },
    [
      // журнал приходит от новых к старым — порядок не важен
      ev("e3", "2026-11-17T10:00:00.100Z", "appointment_created", { before: null, after: meeting({}) }),
      ev("e2", "2026-11-17T10:00:00Z", "updated", status("review", "interview")),
      ev("e1", "2026-11-14T09:30:00Z", "updated", status("new", "review")),
      ev("e0", "2026-11-12T08:00:01Z", "created", { source: "tilda" }, "Система"),
      ev("c1", "2026-11-15T09:00:00Z", "commented", {}),
      ev("u1", "2026-11-15T09:10:00Z", "updated", { changes: { phone: { old: "1", new: "2" } } }),
    ],
  );
  assert.deepEqual(
    items.map((i) => [i.title, i.detail, i.actor]),
    [
      ["Анкета пришла с сайта", null, null],
      ["Можно рассмотреть", null, "Павел Оплочко"],
      ["Назначено собеседование", "на 21 ноября, 14:00", "Павел Оплочко"],
    ],
  );
});

test("timeline: reschedule and outcome of a meeting", () => {
  const before = meeting({});
  const items = candidateTimeline(
    { submitted_at: "2026-11-01T08:00:00Z", source: "notion" },
    [
      ev("m1", "2026-11-18T10:00:00Z", "appointment_updated", { before, after: meeting({ appointment_date: "2026-11-22", starts_at: "2026-11-22T12:30:00Z" }) }),
      ev("m2", "2026-11-22T15:00:00Z", "appointment_updated", { before: meeting({ appointment_date: "2026-11-22", starts_at: "2026-11-22T12:30:00Z" }), after: meeting({ appointment_date: "2026-11-22", starts_at: "2026-11-22T12:30:00Z", outcome: "passed" }) }),
      ev("m3", "2026-11-22T15:05:00Z", "appointment_updated", { before: meeting({ outcome: "passed" }), after: meeting({ outcome: "passed", notes: "ок" }) }),
    ],
  );
  assert.deepEqual(items.map((i) => [i.title, i.detail]), [
    ["Анкета перенесена из прежней базы", null],
    ["Собеседование перенесено", "на 22 ноября, 15:30"],
    ["Собеседование: пройдено", null],
  ]);
});

test("timeline: stage change without a meeting is shown; rejection and hiring", () => {
  const items = candidateTimeline(
    { submitted_at: "2026-11-01T08:00:00Z", source: "manual" },
    [
      ev("s1", "2026-11-02T08:00:00Z", "updated", status("new", "trial")),
      ev("s2", "2026-11-03T08:00:00Z", "updated", status("trial", "rejected")),
      ev("s3", "2026-11-04T08:00:00Z", "hired", status("rejected", "hired")),
    ],
  );
  assert.deepEqual(items.map((i) => i.title), [
    "Анкета добавлена вручную", "Этап «Стажировка»", "Не подходит", "Принят на работу",
  ]);
});

test("meetingWhen: date only when there is no time", () => {
  assert.equal(meetingWhen({ appointment_date: "2026-11-22", starts_at: null }), "22 ноября");
  assert.equal(meetingWhen({}), null);
});

test("timelineDate: Moscow time, year only for other years", () => {
  const now = new Date("2026-11-19T10:00:00Z");
  assert.equal(timelineDate("2026-11-14T09:30:00Z", now), "14 ноября, 12:30");
  // 22:30 UTC 31 декабря — уже 1 января текущего года по Москве.
  assert.equal(timelineDate("2025-12-31T22:30:00Z", now), "1 января, 01:30");
  assert.equal(timelineDate("2025-11-14T09:30:00Z", now), "14 ноября 2025, 12:30");
});
