import { test } from "node:test";
import assert from "node:assert/strict";

import { KB_ICON_PICKER_COLUMNS, KB_PICKER_ICON_GROUPS, KB_ICONS, isKbLucideIcon } from "./icons.ts";
import { CATEGORY_COLORS } from "../palette.ts";

/**
 * Окно выбора значка без пустых хвостов (замечание владельца 28.11.2026):
 * каждая группа — полные ряды, цвета — ровно одна строка той же сетки.
 */
test("every picker group fills whole rows", () => {
  for (const { group, items } of KB_PICKER_ICON_GROUPS) {
    assert.equal(items.length % KB_ICON_PICKER_COLUMNS, 0, `${group}: ${items.length}`);
  }
});

test("colours offered in the picker fill exactly one row", () => {
  // Тот самый набор, что рисует выбор цвета в окне.
  assert.equal(CATEGORY_COLORS.length, KB_ICON_PICKER_COLUMNS);
});

test("icons hidden from the picker still render on existing pages", () => {
  for (const name of ["bug", "code", "terminal", "git-branch", "database", "plus", "minus", "equal", "medal", "box", "shield", "ice-cream"]) {
    assert.ok(isKbLucideIcon(name), name);
    assert.ok(!KB_PICKER_ICON_GROUPS.some((g) => g.items.some((i) => i.name === name)), `${name} в окне`);
  }
});

test("icon names are unique", () => {
  const names = KB_ICONS.map((i) => i.name);
  assert.equal(new Set(names).size, names.length);
});
