import test from "node:test";
import assert from "node:assert/strict";
import { HISTORY_FROM, historyDayToEnqueue } from "./history-backfill.ts";

const base = { existing: new Set(["2026-06-01", "2026-06-02"]), failedTimes: new Map<string, number>(), busy: false };

test("historyDayToEnqueue: занята очередь — ничего", () =>
  assert.equal(historyDayToEnqueue({ ...base, busy: true }), null));

test("historyDayToEnqueue: идёт назад от первого дня", () =>
  assert.equal(historyDayToEnqueue(base), "2026-05-31"));

test("historyDayToEnqueue: пропускает трижды упавший день", () =>
  assert.equal(historyDayToEnqueue({ ...base, failedTimes: new Map([["2026-05-31", 3]]) }), "2026-05-30"));

test("historyDayToEnqueue: пять упавших дней подряд — Quick Resto не отдаёт историю, стоп", () => {
  const failed = new Map(["2026-05-31", "2026-05-30", "2026-05-29", "2026-05-28", "2026-05-27"].map((d) => [d, 3]));
  assert.equal(historyDayToEnqueue({ ...base, failedTimes: failed }), null);
});

test("historyDayToEnqueue: дошёл до начала истории — ничего", () =>
  assert.equal(historyDayToEnqueue({ ...base, existing: new Set([HISTORY_FROM]) }), null));

test("historyDayToEnqueue: дней нет совсем — ничего (история только к уже идущей загрузке)", () =>
  assert.equal(historyDayToEnqueue({ ...base, existing: new Set() }), null));
