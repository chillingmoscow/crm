import { test } from "node:test";
import assert from "node:assert/strict";
import type { AuditEvent } from "./list.ts";
import { groupEventsByDate } from "./group-by-date.ts";

const ev = (id: string, created_at: string) =>
  ({ id, created_at }) as unknown as AuditEvent;

test("сутки считаются в часовом поясе заведения", () => {
  const now = new Date("2026-11-19T09:00:00Z"); // 12:00 в Москве
  const groups = groupEventsByDate(
    [
      ev("a", "2026-11-19T08:00:00Z"),
      // 22:30 UTC 18-го = 01:30 19-го в Москве — тоже «Сегодня».
      ev("b", "2026-11-18T22:30:00Z"),
      ev("c", "2026-11-18T10:00:00Z"),
      ev("d", "2026-11-05T10:00:00Z"),
      ev("e", "2025-12-31T10:00:00Z"),
    ],
    "Europe/Moscow",
    now,
  );
  assert.deepEqual(
    groups.map((g) => [g.dayKey, g.title, g.events.map((e) => e.id).join("")]),
    [
      ["2026-11-19", "Сегодня", "ab"],
      ["2026-11-18", "Вчера", "c"],
      ["2026-11-05", "5 ноября", "d"],
      ["2025-12-31", "31 декабря 2025", "e"],
    ],
  );
});

test("тот же момент в UTC попадает в предыдущий день", () => {
  const now = new Date("2026-11-19T09:00:00Z");
  const groups = groupEventsByDate(
    [ev("b", "2026-11-18T22:30:00Z")],
    "UTC",
    now,
  );
  assert.equal(groups[0].title, "Вчера");
});

test("пустой вход — пустой список", () => {
  assert.deepEqual(groupEventsByDate([]), []);
});
