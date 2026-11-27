import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { collectionCss, offScaleDeclarations, parseCssRules, type CssRule } from "./css-scale.ts";

/**
 * Сторож шкалы DS для блока «Коллекция» (docs/design-system.md → «База
 * знаний» → «Коллекции»). Вид коллекции задаёт участок `globals.css` между
 * маркерами «Collection block» и «Плавный переход тем».
 */
const css = collectionCss(readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8"));
const rules = parseCssRules(css);

function collectionRules(parts: string[]): CssRule[] {
  return rules.filter((rule) =>
    parts.some((part) => rule.selector.includes(`kb-collection${part}`)),
  );
}

function report(found: ReturnType<typeof offScaleDeclarations>): string {
  return found.map((d) => `${d.selector} → ${d.prop}: ${d.value}`).join("\n");
}

test("the collection section is found in globals.css", () => {
  assert.ok(rules.length > 50, "участок коллекций не найден по маркерам");
});

const HEADER_PARTS = [
  "-block",
  "-header",
  "-title",
  "-count",
  "-view-tab",
  "-view-add-inline",
  "-actions",
  "-search",
  "-icon-btn",
  "-add-btn",
];

test("header and toolbar are on the DS scale", () => {
  const found = offScaleDeclarations(collectionRules(HEADER_PARTS));
  assert.deepEqual(found, [], report(found));
});

test("no own box-shadow on toolbar buttons", () => {
  const shadows = collectionRules(["-icon-btn", "-add-btn"]).flatMap((rule) =>
    rule.declarations.filter((d) => d.prop === "box-shadow"),
  );
  assert.deepEqual(shadows, []);
});

const POPOVER_PARTS = [
  "-create-view",
  "-view-menu",
  "-view-overflow",
  "-view-icon",
  "-view-description",
  "-view-row",
  "-view-list",
  "-view-actions",
  "-views-editor",
  "-view-source-row",
  "-layout-",
  "-settings",
  "-field-select",
  "-field-toggle",
  "-filter",
  "-sort",
  "-grouping",
  "-property-visibility",
  "-properties-editor",
  "-field-editor",
  "-field-type",
  "-native-select",
  "-column-menu",
  "-column-description",
  "-column-insert",
  "-column-type",
  "-column-create-btn",
  "-add-field-row",
  "-inline-icon-picker",
];

test("popovers and menus are on the DS scale", () => {
  const found = offScaleDeclarations(collectionRules(POPOVER_PARTS));
  assert.deepEqual(found, [], report(found));
});

test("popovers keep PopoverContent radius and shadow", () => {
  const shells = [
    ".kb-collection-create-view-menu",
    ".kb-collection-view-menu",
    ".kb-collection-view-overflow-menu",
    ".kb-collection-settings",
    ".kb-collection-field-select-menu",
    ".kb-collection-column-menu",
  ];
  const own = rules
    .filter((rule) => shells.some((shell) => rule.selector.split(",").some((s) => s.trim() === shell)))
    .flatMap((rule) =>
      rule.declarations
        .filter((d) => d.prop === "border-radius" || d.prop === "box-shadow")
        .map((d) => `${rule.selector} → ${d.prop}`),
    );
  assert.deepEqual(own, []);
});

const BODY_PARTS = [
  "-table",
  "-column-resize",
  "-column-drop",
  "-column-drag",
  "-list",
  "-grouped-stack",
  "-group",
  "-row",
  "-preview",
  "-properties",
  "-property",
  "-state",
  "-empty",
];

test("table, list and empty state are on the DS scale", () => {
  const found = offScaleDeclarations(collectionRules(BODY_PARTS));
  assert.deepEqual(found, [], report(found));
});

test("whole collection section is on the DS scale", () => {
  const found = offScaleDeclarations(rules, { selectorIncludes: "kb-collection" });
  assert.deepEqual(found, [], report(found));
});
