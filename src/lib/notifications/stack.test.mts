import { test } from "node:test";
import assert from "node:assert/strict";

import { localDayKey, stackNamesPreview, stackNotifications } from "./stack.ts";

const at = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString();
const n = (id: string, type: string, created_at: string) => ({ id, type, created_at });

test("однотипные уведомления одного дня собираются в стопку на месте самого нового", () => {
  const rows = [
    n("a", "candidate.new", at(27, 15)),
    n("b", "schedule.swap_requested", at(27, 14)),
    n("c", "candidate.new", at(27, 12)),
    n("d", "candidate.new", at(27, 9)),
  ];
  const entries = stackNotifications(rows);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]!.kind, "stack");
  assert.deepEqual(
    entries[0]!.kind === "stack" ? entries[0]!.items.map((r) => r.id) : [],
    ["a", "c", "d"],
  );
  assert.equal(entries[1]!.kind, "single");
});

test("одно уведомление типа за день остаётся строкой", () => {
  const entries = stackNotifications([n("a", "candidate.new", at(27, 15))]);
  assert.deepEqual(entries.map((e) => e.kind), ["single"]);
  assert.equal(entries[0]!.key, "a");
});

test("разные дни не смешиваются", () => {
  const entries = stackNotifications([
    n("a", "candidate.new", at(27, 10)),
    n("b", "candidate.new", at(26, 10)),
    n("c", "candidate.new", at(26, 9)),
  ]);
  assert.deepEqual(entries.map((e) => e.kind), ["single", "stack"]);
});

test("ключ стопки стабилен при новых уведомлениях того же дня", () => {
  const before = stackNotifications([
    n("b", "candidate.new", at(27, 10)),
    n("c", "candidate.new", at(27, 9)),
  ]);
  const after = stackNotifications([
    n("a", "candidate.new", at(27, 11)),
    n("b", "candidate.new", at(27, 10)),
    n("c", "candidate.new", at(27, 9)),
  ]);
  assert.equal(before[0]!.key, after[0]!.key);
  assert.equal(after[0]!.key, `stack:candidate.new|${localDayKey(at(27, 9))}`);
});

test("подпись стопки: два имени и остаток", () => {
  assert.equal(stackNamesPreview(["Анна", "Пётр"]), "Анна, Пётр");
  assert.equal(stackNamesPreview(["Анна", "Пётр", "Анна", "Ольга", null]), "Анна, Пётр и ещё 1");
  assert.equal(stackNamesPreview([]), "");
});
