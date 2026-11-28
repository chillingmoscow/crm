import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseCssRules } from "./css-scale.ts";

/**
 * Мостик токенов BlockNote → DS. Класс .bn-sheerly стоит на том же
 * элементе, что и тема BN `.bn-container[data-color-scheme=…]` (класс +
 * атрибут). С одним классом наши переменные проигрывали молча: текст статьи
 * был #3f3f3f, выбранный пункт меню серым, ручка блока #cfcfcf.
 */
const rules = parseCssRules(readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8"));

function rulesDeclaring(prop: string) {
  return rules.filter((r) => r.declarations.some((d) => d.prop === prop));
}

for (const prop of ["--bn-colors-editor-text", "--bn-colors-selected-background", "--bn-colors-highlights-red-text"]) {
  test(`${prop} is set with a selector stronger than BN's theme`, () => {
    const found = rulesDeclaring(prop);
    assert.ok(found.length > 0, `нет правила с ${prop}`);
    for (const rule of found) {
      assert.match(rule.selector, /\.bn-root\.bn-container\.bn-sheerly/, rule.selector);
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
