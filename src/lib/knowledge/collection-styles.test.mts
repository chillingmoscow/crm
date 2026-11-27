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
