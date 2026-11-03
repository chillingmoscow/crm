import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INVENTORY_ACTS_TIERS,
  detectInventoryActsTier,
} from "../../app/(dashboard)/people/roles/[roleId]/_components/permission-modules.ts";

const tier = (id: string) => {
  const t = INVENTORY_ACTS_TIERS.find((x) => x.id === id);
  assert.ok(t, id);
  return new Set(t.codes);
};

// Эти права объявлены в модуле inventory_documents, а он целиком входит в секцию
// «Акты инвентаризации». Роль, получившая право миграцией, но не вошедшая в набор
// уровня, показывается как «Свой набор», а кнопка уровня молча забирает право.
test("право ставить удержания входит в «Полный доступ», разнос списаний - в «Редактор»", () => {
  assert.ok(tier("full").has("inventory.post_deductions"));
  assert.ok(tier("full").has("inventory.assign_writeoff_pool"));
  assert.ok(tier("editor").has("inventory.assign_writeoff_pool"));
  assert.ok(!tier("editor").has("inventory.post_deductions"), "ставить удержания - только полный доступ");
});

test("роль с финализацией и правом ставить удержания определяется как «Полный доступ»", () => {
  assert.equal(detectInventoryActsTier(tier("full")), "full");
  const withoutPosting = tier("full");
  withoutPosting.delete("inventory.post_deductions");
  assert.equal(detectInventoryActsTier(withoutPosting), "custom");
});
