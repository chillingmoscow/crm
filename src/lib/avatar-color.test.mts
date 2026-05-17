import { test } from "node:test";
import assert from "node:assert/strict";
import { avatarDotClass } from "./avatar-color.ts";

test("avatarDotClass is deterministic for the same key", () => {
  assert.equal(avatarDotClass("user-1"), avatarDotClass("user-1"));
});

test("avatarDotClass returns a non-empty tailwind class", () => {
  const cls = avatarDotClass("Андрей Петров");
  assert.equal(typeof cls, "string");
  assert.ok(cls.length > 0);
});

test("avatarDotClass never returns the transparent default", () => {
  for (const k of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
    assert.ok(!avatarDotClass(k).includes("transparent"));
  }
});
