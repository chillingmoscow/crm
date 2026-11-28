import test from "node:test";
import assert from "node:assert/strict";

import { taskDefinitionSchema } from "./tasks.ts";
import { DEFAULT_TOBACCO_SECTIONS } from "../stock-count/tobacco-weighing.ts";

const base = {
  name: "Взвешивание табака",
  instructions: "",
  review_mode: "auto",
  recurrence: { unit: "week", interval: 1, anchor: "2026-11-23" },
  starts_on: "2026-11-23",
  fine_amount: null,
  reward_amount: null,
  template_id: "11111111-1111-4111-8111-111111111111",
};

const config = {
  mode: "tobacco_weighing" as const,
  storeId: "22222222-2222-4222-8222-222222222222",
  telegramChatId: null,
  sections: DEFAULT_TOBACCO_SECTIONS.map((s) => ({
    ...s,
    productId: "33333333-3333-4333-8333-333333333333",
  })),
};

test("включённая stock_count с items: [] и count_config проходит", () => {
  const r = taskDefinitionSchema.safeParse({
    ...base, kind: "stock_count", enabled: true, items: [], count_config: config,
  });
  assert.equal(r.success, true);
});

test("включённая stock_count без count_config отвергается", () => {
  const r = taskDefinitionSchema.safeParse({
    ...base, kind: "stock_count", enabled: true, items: [], count_config: null,
  });
  assert.equal(r.success, false);
  assert.ok(
    r.error?.issues.some(
      (i) => i.message === "Для включения задачи укажите склад и позиции взвешивания",
    ),
  );
});

test("выключенная stock_count без count_config допустима", () => {
  const r = taskDefinitionSchema.safeParse({
    ...base, kind: "stock_count", enabled: false, items: [], count_config: null,
  });
  assert.equal(r.success, true);
});

test("checklist без items — прежнее сообщение", () => {
  const r = taskDefinitionSchema.safeParse({
    ...base, kind: "checklist", enabled: true, items: [],
  });
  assert.equal(r.success, false);
  assert.ok(
    r.error?.issues.some(
      (i) => i.message === "Для включения задачи укажите смену, повтор и чек-лист",
    ),
  );
});

test("вид по умолчанию — checklist, count_config — null", () => {
  const r = taskDefinitionSchema.parse({ ...base, enabled: false, items: [] });
  assert.equal(r.kind, "checklist");
  assert.equal(r.count_config, null);
});
