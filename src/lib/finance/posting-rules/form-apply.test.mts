import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyRulesToForm,
  fillableFrom,
  markUserChoice,
  type FormRuleState,
} from "./form-apply.ts";

function state(partial: Partial<FormRuleState> = {}): FormRuleState {
  return {
    values: { category_id: null, counterparty_id: null, venue_id: null },
    sources: { category_id: "empty", counterparty_id: "empty", venue_id: "empty" },
    ruleIds: {},
    filterVenueId: null,
    ...partial,
  };
}

test("заведение из фильтра заменяется правилом", () => {
  const before = state({
    values: { category_id: null, counterparty_id: null, venue_id: "v-filter" },
    sources: { category_id: "empty", counterparty_id: "empty", venue_id: "filter" },
    filterVenueId: "v-filter",
  });
  assert.equal(fillableFrom(before).venue_id, true);
  const after = applyRulesToForm(before, { venue_id: { value: "v-rule", ruleId: "r1" } });
  assert.equal(after.values.venue_id, "v-rule");
  assert.equal(after.sources.venue_id, "rule");
  assert.equal(after.ruleIds.venue_id, "r1");
});

test("«Без заведения», выбранное руками, правило не трогает", () => {
  const chosen = markUserChoice(
    state({
      values: { category_id: null, counterparty_id: null, venue_id: "v-filter" },
      sources: { category_id: "empty", counterparty_id: "empty", venue_id: "filter" },
      filterVenueId: "v-filter",
    }),
    "venue_id",
    null,
  );
  assert.equal(chosen.values.venue_id, null);
  assert.equal(fillableFrom(chosen).venue_id, false);
  const after = applyRulesToForm(chosen, { venue_id: { value: "v-rule", ruleId: "r1" } });
  assert.equal(after.values.venue_id, null);
  assert.equal(after.sources.venue_id, "user");
});

test("поле, выбранное руками, правило не трогает", () => {
  const chosen = markUserChoice(state(), "category_id", "cat-own");
  const after = applyRulesToForm(chosen, { category_id: { value: "cat-rule", ruleId: "r1" } });
  assert.equal(after.values.category_id, "cat-own");
  assert.equal(after.sources.category_id, "user");
});

test("выбор руками снимает пометку правила", () => {
  const filled = applyRulesToForm(state(), { category_id: { value: "cat-rule", ruleId: "r1" } });
  const chosen = markUserChoice(filled, "category_id", "cat-own");
  assert.equal(chosen.ruleIds.category_id, undefined);
  assert.equal(chosen.sources.category_id, "user");
});

test("подставленное правилом очищается, когда правило перестало подходить", () => {
  const filled = applyRulesToForm(state(), {
    category_id: { value: "cat-rule", ruleId: "r1" },
    counterparty_id: { value: "cp-rule", ruleId: "r2" },
  });
  const after = applyRulesToForm(filled, {});
  assert.equal(after.values.category_id, null);
  assert.equal(after.sources.category_id, "empty");
  assert.equal(after.values.counterparty_id, null);
  assert.deepEqual(after.ruleIds, {});
});

test("заведение от правила откатывается к заведению фильтра", () => {
  const filled = applyRulesToForm(
    state({
      values: { category_id: null, counterparty_id: null, venue_id: "v-filter" },
      sources: { category_id: "empty", counterparty_id: "empty", venue_id: "filter" },
      filterVenueId: "v-filter",
    }),
    { venue_id: { value: "v-rule", ruleId: "r1" } },
  );
  const after = applyRulesToForm(filled, {});
  assert.equal(after.values.venue_id, "v-filter");
  assert.equal(after.sources.venue_id, "filter");
});

test("смена типа убирает статью от правила, которая больше не подходит", () => {
  // Правило поставило статью расхода; после смены типа на приход вычислитель
  // этой статьи не вернёт — форма должна её убрать, а не оставить чужую статью.
  const filled = applyRulesToForm(state(), { category_id: { value: "cat-supply", ruleId: "r1" } });
  const after = applyRulesToForm(filled, {});
  assert.equal(after.values.category_id, null);
});

test("другое правило заменяет подстановку прежнего", () => {
  const filled = applyRulesToForm(state(), { category_id: { value: "cat-a", ruleId: "r1" } });
  assert.equal(fillableFrom(filled).category_id, true);
  const after = applyRulesToForm(filled, { category_id: { value: "cat-b", ruleId: "r2" } });
  assert.equal(after.values.category_id, "cat-b");
  assert.equal(after.ruleIds.category_id, "r2");
});

test("пустое поле без подходящего правила остаётся пустым", () => {
  const before = state();
  assert.deepEqual(applyRulesToForm(before, {}), before);
});

test("форма открылась заново: описание — исходное, заполненное — выбор человека, фильтр — подсказка", async () => {
  const { resetFormRuleState } = await import("./form-apply.ts");
  const copy = resetFormRuleState(
    { category_id: "cat-a", counterparty_id: null, venue_id: "v-filter" },
    "v-filter",
    "Комиссия СБП",
  );
  assert.equal(copy.description, "Комиссия СБП");
  assert.deepEqual(copy.state.sources, { category_id: "user", counterparty_id: "empty", venue_id: "filter" });
  assert.equal(copy.state.filterVenueId, "v-filter");
  const edit = resetFormRuleState({ category_id: null, counterparty_id: null, venue_id: "v-1" }, null, "");
  assert.equal(edit.state.sources.venue_id, "user");
});
