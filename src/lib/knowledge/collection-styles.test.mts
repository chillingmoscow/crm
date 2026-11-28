import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

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

const globalsCss = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

test("the collection section keeps all of its rules", () => {
  // Сторож видит только участок между маркерами: если правила уедут за
  // маркер, тест выше молча станет проверять меньше.
  // 290 правил на 27.11.2026; порог с запасом под чистку.
  assert.ok(rules.length >= 250, `в участке ${rules.length} правил`);
});

test("collection rules anywhere in globals.css are on the DS scale", () => {
  const found = offScaleDeclarations(parseCssRules(globalsCss), { selectorIncludes: "kb-collection" });
  assert.deepEqual(found, [], report(found));
});

function rule(selector: string): CssRule {
  const found = rules.find((r) => r.selector.split(",").some((s) => s.trim() === selector));
  assert.ok(found, `нет правила ${selector}`);
  return found;
}

function value(selector: string, prop: string): string | undefined {
  return rule(selector).declarations.find((d) => d.prop === prop)?.value;
}

test("group labels in collection popovers are 12 / 500 (DS «Меню редактора»)", () => {
  for (const selector of [
    ".kb-collection-create-view-title",
    ".kb-collection-settings-title",
    ".kb-collection-property-visibility-heading",
    ".kb-collection-column-insert-subtitle",
  ]) {
    assert.equal(value(selector, "font-size"), "12px", selector);
    assert.equal(value(selector, "font-weight"), "500", selector);
  }
});

test("menu rows in collection popovers are 14px with radius 6", () => {
  for (const selector of [
    ".kb-collection-view-row",
    ".kb-collection-view-overflow-row",
    ".kb-collection-settings-nav-row",
    ".kb-collection-field-select-option",
    ".kb-collection-column-menu-row",
    ".kb-collection-column-type-option",
  ]) {
    assert.equal(value(selector, "font-size"), "14px", selector);
    assert.equal(value(selector, "border-radius"), "6px", selector);
  }
});

test("fields inside collection popovers are 36px high", () => {
  for (const selector of [
    ".kb-collection-filter-select",
    ".kb-collection-grouping-select",
    ".kb-collection-field-select-trigger",
    ".kb-collection-field-select-search",
    ".kb-collection-property-visibility-search",
    ".kb-collection-column-description-input",
    ".kb-collection-view-overflow-search",
  ]) {
    assert.equal(value(selector, "height"), "36px", selector);
  }
});

test("view layout tiles: bordered, 13 / 500, active without inset shadow", () => {
  for (const selector of [".kb-collection-create-view-option", ".kb-collection-layout-card"]) {
    assert.equal(value(selector, "font-size"), "13px", selector);
    assert.equal(value(selector, "font-weight"), "500", selector);
    assert.equal(value(selector, "border-radius"), "8px", selector);
    assert.ok(value(selector, "border")?.includes("hsl(var(--border))"), selector);
  }
  assert.equal(value(".kb-collection-layout-card[data-active]", "box-shadow"), undefined);
  assert.equal(value(".kb-collection-layout-card[data-active]", "background-color"), "hsl(var(--brand) / 0.1)");
});

function collectionSources(): string {
  const dir = new URL("../../components/knowledge/blocks/", import.meta.url);
  const files = [
    "kb-collection-block.tsx",
    ...readdirSync(new URL("collection/", dir), { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
      .map((f) => `collection/${f}`),
  ];
  return files.map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
}

test("every .kb-collection-* class in CSS is used by the block", () => {
  const sources =
    collectionSources() + readFileSync(new URL("../../components/knowledge/blocknote-editor.tsx", import.meta.url), "utf8");
  const classes = new Set(css.match(/\.kb-collection-[a-z0-9-]+/g)?.map((c) => c.slice(1)) ?? []);
  const dead = [...classes].filter((c) => !sources.includes(c));
  assert.deepEqual(dead, []);
});

test("collection components use only scale values in arbitrary Tailwind classes", () => {
  const sources = collectionSources();
  const bad = [
    ...(sources.match(/text-\[\d+(?:\.\d+)?px\]/g) ?? []).filter((c) => !["text-[13px]", "text-[28px]"].includes(c)),
    ...(sources.match(/font-\[\d+\]/g) ?? []),
    ...(sources.match(/rounded-\[\d+px\]/g) ?? []).filter((c) => !["rounded-[10px]", "rounded-[14px]"].includes(c)),
  ];
  assert.deepEqual(bad, []);
});
