import { test } from "node:test";
import assert from "node:assert/strict";
import { KB_PROPERTY_UI_ICONS } from "./property-ui-icons.ts";

test("KB_PROPERTY_UI_ICONS values are mutually distinct (no icon collisions)", () => {
  const entries = Object.entries(KB_PROPERTY_UI_ICONS);
  const seen = new Map<unknown, string>();
  for (const [key, icon] of entries) {
    const prev = seen.get(icon);
    assert.equal(
      prev,
      undefined,
      prev
        ? `Icon collision: "${key}" and "${prev}" use the same lucide icon`
        : undefined,
    );
    seen.set(icon, key);
  }
  assert.equal(seen.size, entries.length);
});
