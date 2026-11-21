import { test } from "node:test";
import assert from "node:assert/strict";
import { zReportIdsInWindow } from "./z-window.ts";

// Рабочий день 21 ноября в Москве (UTC+3) с 09:00: 06:00Z 21-го — 06:00Z 22-го.
const day = (list: unknown[]) =>
  zReportIdsInWindow(list, "2026-11-21", "Europe/Moscow", 9);

test("касса, открытая после полуночи, относится к прошлому рабочему дню", () => {
  assert.deepEqual(
    day([
      { id: 1, opened: "2026-11-21T09:05:00+03:00" },
      { id: 2, opened: "2026-11-22T01:30:00+03:00" },
    ]),
    [1, 2],
  );
});

test("утренняя касса до начала дня и касса следующего дня не попадают", () => {
  assert.deepEqual(
    day([
      { id: 3, opened: "2026-11-21T08:59:00+03:00" },
      { id: 4, opened: "2026-11-22T09:00:00+03:00" },
      { id: 5, opened: "2026-11-21T06:00:00.000Z" },
    ]),
    [5],
  );
});

test("отчёт без времени открытия или повтор — ошибка, а не пропуск", () => {
  assert.throws(() => day([{ id: 6 }]), /времени открытия/);
  assert.throws(
    () =>
      day([
        { id: 7, opened: "2026-11-21T10:00:00Z" },
        { id: 7, opened: "2026-11-21T10:00:00Z" },
      ]),
    /повторяются/,
  );
});
