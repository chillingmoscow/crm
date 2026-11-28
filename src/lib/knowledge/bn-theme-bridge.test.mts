import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseCssRules } from "./css-scale.ts";

/**
 * Мостик токенов BlockNote → DS. Тема BN — `.bn-root` и
 * `.bn-root[data-color-scheme="dark"]` на том же элементе, что и .bn-sheerly;
 * с одним классом наши переменные проигрывали молча (текст статьи #3f3f3f,
 * ручка #cfcfcf, палитра BN). Корней два — редактор и портал меню на body
 * без `.bn-container`, поэтому селектор `.bn-root.bn-sheerly[data-color-scheme]`.
 */
const rules = parseCssRules(readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8"));

function rulesDeclaring(prop: string) {
  return rules.filter((r) => r.declarations.some((d) => d.prop === prop));
}

for (const prop of ["--bn-colors-editor-text", "--bn-colors-side-menu", "--bn-colors-highlights-red-text"]) {
  test(`${prop} is set with a selector stronger than BN's theme`, () => {
    const found = rulesDeclaring(prop);
    assert.ok(found.length > 0, `нет правила с ${prop}`);
    for (const rule of found) {
      // Без .bn-container: он есть только у редактора, а меню («/», цвет,
      // меню блока) живут в портале на body.
      assert.equal(rule.selector, ".bn-root.bn-sheerly[data-color-scheme]");
    }
  });
}

test("the block menu does not clip its colour submenu", () => {
  const menu = rules.find((r) => r.selector === ".bn-menu-dropdown.bn-drag-handle-menu");
  assert.ok(menu);
  assert.ok(
    menu.declarations.some((d) => d.prop === "overflow" && d.value.startsWith("visible")),
    "подменю «Цвет» рисуется внутри меню блока без портала",
  );
});
