import assert from "node:assert/strict";
import test from "node:test";

import { canAdoptLegacyDraft, inventoryDraftKey, legacyInventoryDraftKey } from "./draft-key.ts";

test("ключ черновика зависит от пользователя и не совпадает со старым", () => {
  assert.notEqual(inventoryDraftKey("doc", "u1"), inventoryDraftKey("doc", "u2"));
  assert.notEqual(inventoryDraftKey("doc", "u1"), legacyInventoryDraftKey("doc"));
  assert.equal(legacyInventoryDraftKey("doc"), "inventory:doc");
});

test("старый черновик забирает только исполнитель акта", () => {
  assert.equal(canAdoptLegacyDraft({ assignedTo: "u1", userId: "u1" }), true);
  assert.equal(canAdoptLegacyDraft({ assignedTo: "u1", userId: "u2" }), false);
  assert.equal(canAdoptLegacyDraft({ assignedTo: null, userId: "u1" }), false);
});
