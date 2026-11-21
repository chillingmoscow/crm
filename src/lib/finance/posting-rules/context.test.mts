import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRuleContext, buildRuleNames, type RuleDirectories } from "./context.ts";

const dirs: RuleDirectories = {
  counterparties: [
    { id: "cp-a", name: "ООО «А»", inn: "7719089011", group_id: "g-1", deleted_at: null },
    { id: "cp-old", name: "ООО «Старое»", inn: null, group_id: null, deleted_at: "2026-01-01" },
  ],
  counterpartyGroups: [{ id: "g-1", name: "Поставщики" }],
  bankAccounts: [
    { id: "acc-sber", name: "СБЕР Бизнес", deleted_at: null },
    { id: "acc-old", name: "Закрытый", deleted_at: "2026-01-01" },
  ],
  categories: [
    { id: "cat-supply", name: "Поставки", type: "expense", archived_at: null },
    { id: "cat-old", name: "Старая", type: "income", archived_at: "2026-01-01" },
  ],
  venues: [
    { id: "v-1", name: "CHILLING", archived_at: null },
    { id: "v-2", name: "Второе", archived_at: null },
    { id: "v-old", name: "Закрытое", archived_at: "2026-01-01" },
  ],
};

test("архивные записи справочников попадают в неактивные", () => {
  const ctx = buildRuleContext(dirs, null);
  assert.deepEqual([...ctx.inactiveIds].sort(), ["acc-old", "cat-old", "cp-old", "v-old"]);
});

test("контрагенты и типы статей доступны вычислителю", () => {
  const ctx = buildRuleContext(dirs, null);
  assert.deepEqual(ctx.counterparties.get("cp-a"), { inn: "7719089011", group_id: "g-1" });
  assert.equal(ctx.categoryTypes.get("cat-supply"), "expense");
});

test("доступные заведения: null — все, иначе только перечисленные", () => {
  assert.equal(buildRuleContext(dirs, null).allowedVenueIds, null);
  assert.deepEqual([...(buildRuleContext(dirs, ["v-1"]).allowedVenueIds ?? [])], ["v-1"]);
});

test("названия: недоступное заведение и неизвестный id — null, архивная статья — с названием", () => {
  const names = buildRuleNames(dirs, ["v-1"]);
  assert.equal(names.lookup("venue", "v-1"), "CHILLING");
  assert.equal(names.lookup("venue", "v-2"), null);
  assert.equal(names.lookup("bank_account", "acc-hidden"), null);
  assert.equal(names.lookup("category", "cat-old"), "Старая");
  assert.equal(names.lookup("counterparty_group", "g-1"), "Поставщики");
  assert.equal(buildRuleNames(dirs, null).lookup("venue", "v-2"), "Второе");
});
