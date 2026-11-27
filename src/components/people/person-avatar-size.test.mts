import test from "node:test";
import assert from "node:assert/strict";

import { personAvatarSize } from "./person-avatar-size.ts";

test("personAvatarSize: четыре размера по шкале аватаров", () => {
  assert.deepEqual(personAvatarSize("lg"), { box: "size-9", text: "text-xs", px: 36 });
  assert.deepEqual(personAvatarSize("md"), { box: "size-7", text: "text-xs", px: 28 });
  assert.deepEqual(personAvatarSize("sm"), { box: "size-5", text: "text-[10px]", px: 20 });
  assert.deepEqual(personAvatarSize("xs"), { box: "size-[14px]", text: "text-[8px]", px: 14 });
});

test("personAvatarSize: без размера — 36px, как раньше", () => {
  assert.deepEqual(personAvatarSize(undefined), personAvatarSize("lg"));
});
