import { test } from "node:test";
import assert from "node:assert/strict";
import { groupConsecutiveRows } from "./group-rows.ts";

test("подряд идущие строки с одним ключом — одна группа, порядок сохраняется", () => {
  const rows = ["2026-11-20:a", "2026-11-20:b", "2026-11-19:c", "2026-11-20:d"];
  const groups = groupConsecutiveRows(rows, (row) => row.slice(0, 10));
  assert.deepEqual(
    groups.map((group) => [group.key, group.rows.map((row) => row.slice(11))]),
    [
      ["2026-11-20", ["a", "b"]],
      ["2026-11-19", ["c"]],
      // Тот же ключ после другой группы — новая группа: строки не переставляем.
      ["2026-11-20", ["d"]],
    ],
  );
  assert.deepEqual(groupConsecutiveRows([], () => ""), []);
});
