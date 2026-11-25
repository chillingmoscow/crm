import { test } from "node:test";
import assert from "node:assert/strict";

import { AUDIT_MODULES, auditModuleOf, modulesToLikePatterns } from "./modules.ts";

test("раздел события определяется по префиксу кода", () => {
  assert.equal(auditModuleOf("catalog.ingredient.photo_updated"), "stock");
  assert.equal(auditModuleOf("catalog.dish_photos.synced"), "stock");
  assert.equal(auditModuleOf("inventory.document_deleted"), "stock");
  assert.equal(auditModuleOf("cash.control.synced"), "finance");
  assert.equal(auditModuleOf("candidate.hired"), "candidates");
  assert.equal(auditModuleOf("kb_thread.resolved"), "kb");
  assert.equal(auditModuleOf("schedule.shifts.published"), "schedule");
  assert.equal(auditModuleOf("schedule.swap.approved"), "schedule");
  assert.equal(auditModuleOf("unknown.thing"), null);
});

test("разделы → like-шаблоны, неизвестные игнорируются", () => {
  assert.deepEqual(modulesToLikePatterns(["staff", "nope"]), [
    "staff.*",
    "invitation.*",
  ]);
  assert.deepEqual(modulesToLikePatterns([]), []);
});

test("префиксы разделов не пересекаются", () => {
  const all = AUDIT_MODULES.flatMap((m) => m.prefixes);
  assert.equal(new Set(all).size, all.length);
  for (const p of all) assert.ok(p.endsWith("."), p);
});
