import { test } from "node:test";
import assert from "node:assert/strict";

import { matchKbHotkey, type KbCommand } from "./kb-hotkeys.ts";

type Ev = Parameters<typeof matchKbHotkey>[0];
const ev = (over: Partial<Ev>): Ev => ({
  key: "l",
  shiftKey: true,
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  ...over,
});

const cases: Array<[string, Ev, KbCommand | null]> = [
  ["meta+shift+l → toggle-lock", ev({ key: "l" }), "toggle-lock"],
  ["uppercase L (shift) → toggle-lock", ev({ key: "L" }), "toggle-lock"],
  ["ctrl+shift+f → toggle-favorite", ev({ key: "f", metaKey: false, ctrlKey: true }), "toggle-favorite"],
  ["meta+shift+d → duplicate", ev({ key: "d" }), "duplicate"],
  ["meta+shift+p → create-page", ev({ key: "p" }), "create-page"],
  ["meta+shift+h → version-history", ev({ key: "h" }), "version-history"],
  ["no shift → null", ev({ key: "l", shiftKey: false }), null],
  ["no mod → null", ev({ key: "l", metaKey: false, ctrlKey: false }), null],
  ["alt held → null", ev({ key: "l", altKey: true }), null],
  ["unmapped letter → null", ev({ key: "z" }), null],
  ["meta+ctrl+shift+l → toggle-lock", ev({ key: "l", ctrlKey: true }), "toggle-lock"],
];

for (const [name, input, expected] of cases) {
  test(name, () => {
    assert.equal(matchKbHotkey(input), expected);
  });
}
