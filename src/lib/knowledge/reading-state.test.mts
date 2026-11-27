import test from "node:test";
import assert from "node:assert/strict";

import { kbReadIsCurrent, kbReadingStatus } from "./reading-state.ts";

test("kbReadIsCurrent: не читал — не действует", () => {
  assert.equal(kbReadIsCurrent(null, null), false);
  assert.equal(kbReadIsCurrent(null, 3), false);
});

test("kbReadIsCurrent: без просьбы перечитать действует любое прочтение", () => {
  assert.equal(kbReadIsCurrent(1, null), true);
});

test("kbReadIsCurrent: прочтение старше порога не действует", () => {
  assert.equal(kbReadIsCurrent(1, 2), false);
});

test("kbReadIsCurrent: прочтение на пороге и новее действует", () => {
  assert.equal(kbReadIsCurrent(2, 2), true);
  assert.equal(kbReadIsCurrent(3, 2), true);
});

test("kbReadingStatus: unread / reread / read", () => {
  assert.equal(kbReadingStatus(null, 2), "unread");
  assert.equal(kbReadingStatus(1, 2), "reread");
  assert.equal(kbReadingStatus(2, 2), "read");
  assert.equal(kbReadingStatus(5, null), "read");
});
