import { test } from "node:test";
import assert from "node:assert/strict";

import { safeAuthRedirectPath } from "./redirects.ts";

test("путь на своём сайте проходит как есть", () => {
  assert.equal(safeAuthRedirectPath("/invite?invitation=1"), "/invite?invitation=1");
  assert.equal(safeAuthRedirectPath("/.//x"), "/.//x");
});

test("чужой домен и подозрительные адреса уходят на запасной путь", () => {
  for (const value of [
    null,
    "",
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r//evil.com",
  ]) {
    assert.equal(safeAuthRedirectPath(value), "/dashboard", JSON.stringify(value));
  }
});
