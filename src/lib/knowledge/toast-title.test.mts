import { test } from "node:test";
import assert from "node:assert/strict";

import { kbToastTitle } from "./toast-title.ts";

test("short title is kept as is", () => {
  assert.equal(kbToastTitle("  Чек-лист бара "), "Чек-лист бара");
});

test("long title is cut to 28 chars with an ellipsis", () => {
  const out = kbToastTitle("Регламент открытия и закрытия смены в зале");
  assert.ok(out.endsWith("…"));
  assert.ok(out.length <= 28);
});
