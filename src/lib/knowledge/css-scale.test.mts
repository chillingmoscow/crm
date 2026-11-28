import { test } from "node:test";
import assert from "node:assert/strict";

import { collectionCss, offScaleDeclarations, parseCssRules } from "./css-scale.ts";

test("off-scale font size and weight are reported", () => {
  const found = offScaleDeclarations(parseCssRules(".a{font-size:13.5px;font-weight:650}"));
  assert.deepEqual(
    found.map((d) => d.value),
    ["13.5px", "650"],
  );
});

test("scale values and selection rings pass", () => {
  const css =
    ".a{font-size:13px;font-weight:600;border-radius:10px;box-shadow:0 0 0 2px hsl(var(--brand) / .12)}" +
    ".b{box-shadow:inset 0 0 0 2px hsl(var(--brand))}.c{box-shadow:theme('boxShadow.md')}.d{box-shadow:none}";
  assert.deepEqual(offScaleDeclarations(parseCssRules(css)), []);
});

test("own drop shadow is reported", () => {
  const found = offScaleDeclarations(
    parseCssRules(".a{box-shadow:0 18px 42px hsl(var(--foreground) / 0.15)}"),
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].prop, "box-shadow");
});

test("rules inside @media are checked with their selector", () => {
  const found = offScaleDeclarations(parseCssRules("@media (max-width:639px){.a{font-size:26px}}"));
  assert.equal(found.length, 1);
  assert.equal(found[0].selector, ".a");
});

test("comments are ignored", () => {
  assert.deepEqual(offScaleDeclarations(parseCssRules("/* font-size: 99px */ .a{color:red}")), []);
});

test("selectorIncludes filters rules", () => {
  const rules = parseCssRules(".kb-gallery-x{font-size:11px}.kb-collection-y{font-size:13px}");
  assert.deepEqual(offScaleDeclarations(rules, { selectorIncludes: "kb-collection" }), []);
});

test("off-scale radius is reported, pill and inherit pass", () => {
  const found = offScaleDeclarations(
    parseCssRules(".a{border-radius:9px}.b{border-radius:999px}.c{border-radius:inherit}"),
  );
  assert.deepEqual(found.map((d) => d.value), ["9px"]);
});

test("collectionCss cuts the collection section between markers", () => {
  const css =
    ".before{font-size:1px}\n/* ── Collection block ─── */\n.kb-collection-a{font-size:13px}\n/* ──── Плавный переход тем */\n.after{}";
  const section = collectionCss(css);
  assert.ok(section.includes(".kb-collection-a"));
  assert.ok(!section.includes(".before"));
  assert.ok(!section.includes(".after"));
});

test("font shorthand is checked for size and weight", () => {
  const found = offScaleDeclarations(parseCssRules(".a{font:650 13.5px/1.2 Inter, sans-serif}.b{font:inherit}"));
  assert.deepEqual(found.map((d) => d.value), ["650", "13.5px"]);
  assert.ok(found.every((d) => d.selector === ".a"));
});

test("radius longhands, prefixed shadows and drop-shadow are checked", () => {
  const found = offScaleDeclarations(
    parseCssRules(
      ".a{border-top-left-radius:9px}.b{-webkit-box-shadow:0 2px 4px red}" +
        ".c{filter:drop-shadow(0 2px 4px red)}.d{filter:saturate(0.9)}",
    ),
  );
  assert.deepEqual(found.map((d) => d.selector), [".a", ".b", ".c"]);
});
