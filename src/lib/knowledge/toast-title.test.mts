import { test } from "node:test";
import assert from "node:assert/strict";

import { KB_TOAST_TITLE_MAX, kbToastTitle } from "./toast-title.ts";

test("short title is kept as is", () => {
  assert.equal(kbToastTitle("  Чек-лист бара "), "Чек-лист бара");
});

test("long title is cut with an ellipsis", () => {
  const out = kbToastTitle("Регламент открытия и закрытия смены в зале");
  assert.ok(out.endsWith("…"));
  assert.ok(Array.from(out).length <= KB_TOAST_TITLE_MAX);
});

test("emoji at the cut is not split into a broken surrogate", () => {
  const out = kbToastTitle("Смена бара 🍸🍸🍸🍸🍸🍸🍸🍸🍸🍸🍸🍸");
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out));
  assert.ok(Array.from(out).length <= KB_TOAST_TITLE_MAX);
});
