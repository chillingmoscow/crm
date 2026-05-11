import test from "node:test";
import assert from "node:assert/strict";

import { safeHref } from "./safe-href.ts";

test("safeHref: allows http and https", () => {
  assert.equal(safeHref("https://example.com/a"), "https://example.com/a");
  assert.equal(safeHref("http://example.com"), "http://example.com");
  assert.equal(safeHref("HTTPS://Example.com"), "HTTPS://Example.com");
});

test("safeHref: allows mailto and tel", () => {
  assert.equal(safeHref("mailto:a@b.c"), "mailto:a@b.c");
  assert.equal(safeHref("tel:+79001234567"), "tel:+79001234567");
});

test("safeHref: allows kbfile (KB attachment scheme)", () => {
  assert.equal(safeHref("kbfile://attachments/abc"), "kbfile://attachments/abc");
});

test("safeHref: blocks javascript: scheme", () => {
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("JAVASCRIPT:alert(1)"), null);
  assert.equal(safeHref("  javascript:alert(1)  "), null);
});

test("safeHref: blocks data: scheme", () => {
  assert.equal(safeHref("data:text/html,<script>alert(1)</script>"), null);
});

test("safeHref: blocks vbscript: scheme", () => {
  assert.equal(safeHref("vbscript:msgbox"), null);
});

test("safeHref: blocks relative paths (no scheme)", () => {
  assert.equal(safeHref("/internal/path"), null);
  assert.equal(safeHref("./relative"), null);
  assert.equal(safeHref("example.com"), null);
});

test("safeHref: trims whitespace before validating", () => {
  assert.equal(
    safeHref("  https://example.com  "),
    "https://example.com",
  );
});

test("safeHref: nullish and empty inputs return null", () => {
  assert.equal(safeHref(null), null);
  assert.equal(safeHref(undefined), null);
  assert.equal(safeHref(""), null);
  assert.equal(safeHref("   "), null);
});

test("safeHref: leading-newline tricks blocked", () => {
  // `\njavascript:` does not start with http/mailto/tel/kbfile after
  // trim(), so it's rejected. Trim handles \n, \r, \t.
  assert.equal(safeHref("\n\tjavascript:alert(1)"), null);
});
