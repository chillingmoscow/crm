import test from "node:test";
import assert from "node:assert/strict";
import { HISTORY_FROM, historyDayToEnqueue, type HistoryDay } from "./history-backfill.ts";

const days = (entries: [string, HistoryDay][]) => new Map(entries);
const base = { days: days([["2026-06-01", "ok"], ["2026-06-02", "ok"]]), failedTimes: new Map<string, number>(), busy: false };

test("historyDayToEnqueue: занята очередь — ничего", () =>
  assert.equal(historyDayToEnqueue({ ...base, busy: true }), null));

test("historyDayToEnqueue: идёт назад от первого дня", () =>
  assert.equal(historyDayToEnqueue(base), "2026-05-31"));

test("historyDayToEnqueue: день с ошибкой загрузки не считается загруженным", () =>
  assert.equal(historyDayToEnqueue({ ...base, days: days([...base.days, ["2026-05-31", "error"]]) }), "2026-05-31"));

test("historyDayToEnqueue: пропускает трижды упавший день, даже если от него осталась строка с ошибкой", () =>
  assert.equal(historyDayToEnqueue({ ...base, days: days([...base.days, ["2026-05-31", "error"]]), failedTimes: new Map([["2026-05-31", 3]]) }), "2026-05-30"));

test("historyDayToEnqueue: пять упавших дней подряд — Quick Resto не отдаёт историю, стоп", () => {
  const failed = new Map(["2026-05-31", "2026-05-30", "2026-05-29", "2026-05-28", "2026-05-27"].map((d) => [d, 3]));
  assert.equal(historyDayToEnqueue({ ...base, failedTimes: failed }), null);
});

test("historyDayToEnqueue: пять самых ранних загруженных дней пустые — история нулевая, стоп", () => {
  const empty = days([...base.days, ...["2026-05-31", "2026-05-30", "2026-05-29", "2026-05-28", "2026-05-27"].map((d): [string, HistoryDay] => [d, "empty"])]);
  assert.equal(historyDayToEnqueue({ ...base, days: empty }), null);
});

test("historyDayToEnqueue: дошёл до начала истории — ничего", () =>
  assert.equal(historyDayToEnqueue({ ...base, days: days([[HISTORY_FROM, "ok"]]) }), null));

test("historyDayToEnqueue: загруженных дней нет совсем — ничего", () =>
  assert.equal(historyDayToEnqueue({ ...base, days: new Map() }), null));
