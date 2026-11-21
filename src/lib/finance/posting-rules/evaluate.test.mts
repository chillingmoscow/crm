import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluatePostingRules,
  ruleMatches,
  ruleNeedsAttention,
} from "./evaluate.ts";
import type {
  PostingRule,
  PostingRuleActionField,
  RuleContext,
  RuleSubject,
} from "./types.ts";

let seq = 0;
function rule(partial: Partial<PostingRule>): PostingRule {
  seq += 1;
  return {
    id: partial.id ?? `r${seq}`,
    name: null,
    position: partial.position ?? seq,
    enabled: true,
    conditions: [],
    actions: {},
    ...partial,
  };
}

function subject(partial: Partial<RuleSubject> = {}): RuleSubject {
  return {
    type: "expense",
    amount: 1000,
    bank_account_id: "acc-sber",
    counterparty_id: null,
    description: null,
    ...partial,
  };
}

function ctx(partial: Partial<RuleContext> = {}): RuleContext {
  return {
    counterparties: new Map([
      ["cp-a", { inn: "7719089011", group_id: "g-suppliers" }],
      ["cp-b", { inn: null, group_id: null }],
      ["cp-t", { inn: "7710140679", group_id: null }],
    ]),
    categoryTypes: new Map([
      ["cat-supply", "expense"],
      ["cat-fee", "expense"],
      ["cat-revenue", "income"],
      ["cat-mixed", "mixed"],
    ]),
    inactiveIds: new Set(),
    allowedVenueIds: null,
    ...partial,
  };
}

const ALL: Record<PostingRuleActionField, boolean> = {
  category_id: true,
  counterparty_id: true,
  venue_id: true,
};

test("контрагент «один из» срабатывает на выбранного из списка", () => {
  const r = rule({ conditions: [{ field: "counterparty", op: "in", ids: ["cp-a", "cp-b"] }] });
  assert.equal(ruleMatches(r, subject({ counterparty_id: "cp-b" }), ctx()), true);
  assert.equal(ruleMatches(r, subject({ counterparty_id: "cp-t" }), ctx()), false);
});

test("контрагент «один из» не срабатывает без контрагента", () => {
  const r = rule({ conditions: [{ field: "counterparty", op: "in", ids: ["cp-a"] }] });
  assert.equal(ruleMatches(r, subject({ counterparty_id: null }), ctx()), false);
});

test("контрагент «ни один из» срабатывает без контрагента", () => {
  const r = rule({ conditions: [{ field: "counterparty", op: "not_in", ids: ["cp-a"] }] });
  assert.equal(ruleMatches(r, subject({ counterparty_id: null }), ctx()), true);
  assert.equal(ruleMatches(r, subject({ counterparty_id: "cp-a" }), ctx()), false);
});

test("группа контрагентов проверяется по группе контрагента", () => {
  const r = rule({ conditions: [{ field: "counterparty_group", op: "in", ids: ["g-suppliers"] }] });
  assert.equal(ruleMatches(r, subject({ counterparty_id: "cp-a" }), ctx()), true);
  assert.equal(ruleMatches(r, subject({ counterparty_id: "cp-b" }), ctx()), false);
  assert.equal(ruleMatches(r, subject({ counterparty_id: null }), ctx()), false);
});

test("ИНН контрагента сравнивается без пробелов по краям", () => {
  const r = rule({ conditions: [{ field: "counterparty_inn", op: "eq", value: " 7719089011 " }] });
  assert.equal(ruleMatches(r, subject({ counterparty_id: "cp-a" }), ctx()), true);
  assert.equal(ruleMatches(r, subject({ counterparty_id: "cp-b" }), ctx()), false);
});

test("сумма «от – до» включает границы, пустая граница открыта", () => {
  const from100 = rule({ conditions: [{ field: "amount", op: "between", min: 100, max: null }] });
  assert.equal(ruleMatches(from100, subject({ amount: 100 }), ctx()), true);
  assert.equal(ruleMatches(from100, subject({ amount: 99.99 }), ctx()), false);
  assert.equal(ruleMatches(from100, subject({ amount: null }), ctx()), false);
  const upTo500 = rule({ conditions: [{ field: "amount", op: "between", min: null, max: 500 }] });
  assert.equal(ruleMatches(upTo500, subject({ amount: 500 }), ctx()), true);
  assert.equal(ruleMatches(upTo500, subject({ amount: 500.01 }), ctx()), false);
});

test("описание сравнивается без учёта регистра, ё и лишних пробелов", () => {
  const text = "  Плата за  ПОПОЛНЕНИЕ по операции СБП, ёлка ";
  const contains = rule({ conditions: [{ field: "description", op: "contains", value: "плата за пополнение" }] });
  assert.equal(ruleMatches(contains, subject({ description: text }), ctx()), true);
  const starts = rule({ conditions: [{ field: "description", op: "starts_with", value: "ПЛАТА ЗА" }] });
  assert.equal(ruleMatches(starts, subject({ description: text }), ctx()), true);
  const eq = rule({ conditions: [{ field: "description", op: "eq", value: "плата за пополнение по операции сбп, елка" }] });
  assert.equal(ruleMatches(eq, subject({ description: text }), ctx()), true);
  const notContains = rule({ conditions: [{ field: "description", op: "not_contains", value: "сбп" }] });
  assert.equal(ruleMatches(notContains, subject({ description: text }), ctx()), false);
  assert.equal(ruleMatches(notContains, subject({ description: null }), ctx()), true);
  assert.equal(ruleMatches(contains, subject({ description: null }), ctx()), false);
});

test("счёт и тип операции", () => {
  const r = rule({
    conditions: [
      { field: "bank_account", op: "in", ids: ["acc-sber"] },
      { field: "type", op: "eq", value: "expense" },
    ],
  });
  assert.equal(ruleMatches(r, subject(), ctx()), true);
  assert.equal(ruleMatches(r, subject({ bank_account_id: "acc-tbank" }), ctx()), false);
  assert.equal(ruleMatches(r, subject({ type: "income" }), ctx()), false);
});

test("все условия соединяются через «и»", () => {
  const r = rule({
    conditions: [
      { field: "counterparty", op: "in", ids: ["cp-a"] },
      { field: "bank_account", op: "in", ids: ["acc-sber"] },
    ],
  });
  assert.equal(ruleMatches(r, subject({ counterparty_id: "cp-a" }), ctx()), true);
  assert.equal(ruleMatches(r, subject({ counterparty_id: "cp-a", bank_account_id: "x" }), ctx()), false);
});

test("переводы правилами не разносятся", () => {
  const r = rule({
    conditions: [{ field: "bank_account", op: "in", ids: ["acc-sber"] }],
    actions: { venue_id: "v-1" },
  });
  assert.equal(ruleMatches(r, subject({ type: "transfer" }), ctx()), false);
  assert.deepEqual(evaluatePostingRules([r], subject({ type: "transfer" }), ctx(), ALL), {});
});

test("правило без условий не срабатывает", () => {
  const r = rule({ conditions: [], actions: { venue_id: "v-1" } });
  assert.equal(ruleMatches(r, subject(), ctx()), false);
});

test("каждое поле заполняет первое сверху подходящее правило", () => {
  const cond = [{ field: "bank_account" as const, op: "in" as const, ids: ["acc-sber"] }];
  const second = rule({ id: "second", position: 2, conditions: cond, actions: { category_id: "cat-fee", venue_id: "v-2" } });
  const first = rule({ id: "first", position: 1, conditions: cond, actions: { category_id: "cat-supply" } });
  assert.deepEqual(evaluatePostingRules([second, first], subject(), ctx(), ALL), {
    category_id: { value: "cat-supply", ruleId: "first" },
    venue_id: { value: "v-2", ruleId: "second" },
  });
});

test("выключенное правило не участвует", () => {
  const r = rule({
    enabled: false,
    conditions: [{ field: "bank_account", op: "in", ids: ["acc-sber"] }],
    actions: { venue_id: "v-1" },
  });
  assert.deepEqual(evaluatePostingRules([r], subject(), ctx(), ALL), {});
});

test("правило со ссылкой на архивную статью не срабатывает и требует внимания", () => {
  const r = rule({
    conditions: [{ field: "bank_account", op: "in", ids: ["acc-sber"] }],
    actions: { category_id: "cat-supply", venue_id: "v-1" },
  });
  const archived = ctx({ inactiveIds: new Set(["cat-supply"]) });
  assert.equal(ruleNeedsAttention(r, archived), true);
  assert.deepEqual(evaluatePostingRules([r], subject(), archived, ALL), {});
  assert.equal(ruleNeedsAttention(r, ctx()), false);
});

test("правило со ссылкой на архивный счёт в условии требует внимания", () => {
  const r = rule({
    conditions: [{ field: "bank_account", op: "in", ids: ["acc-old", "acc-sber"] }],
    actions: { venue_id: "v-1" },
  });
  assert.equal(ruleNeedsAttention(r, ctx({ inactiveIds: new Set(["acc-old"]) })), true);
});

test("правило без действий требует внимания", () => {
  const r = rule({ conditions: [{ field: "bank_account", op: "in", ids: ["acc-sber"] }], actions: {} });
  assert.equal(ruleNeedsAttention(r, ctx()), true);
  const nulls = rule({
    conditions: [{ field: "bank_account", op: "in", ids: ["acc-sber"] }],
    actions: { category_id: null, venue_id: null },
  });
  assert.equal(ruleNeedsAttention(nulls, ctx()), true);
});

test("поле, которое нельзя заполнять, не попадает в результат", () => {
  const r = rule({
    conditions: [{ field: "bank_account", op: "in", ids: ["acc-sber"] }],
    actions: { category_id: "cat-supply", venue_id: "v-1" },
  });
  assert.deepEqual(
    evaluatePostingRules([r], subject(), ctx(), { ...ALL, venue_id: false }),
    { category_id: { value: "cat-supply", ruleId: r.id } },
  );
});

test("контрагент из правила участвует во втором проходе", () => {
  const byText = rule({
    id: "by-text",
    position: 2,
    conditions: [{ field: "description", op: "contains", value: "сбп" }],
    actions: { counterparty_id: "cp-t" },
  });
  const byCounterparty = rule({
    id: "by-cp",
    position: 1,
    conditions: [{ field: "counterparty", op: "in", ids: ["cp-t"] }],
    actions: { category_id: "cat-fee" },
  });
  assert.deepEqual(
    evaluatePostingRules([byText, byCounterparty], subject({ description: "Комиссия СБП" }), ctx(), ALL),
    {
      counterparty_id: { value: "cp-t", ruleId: "by-text" },
      category_id: { value: "cat-fee", ruleId: "by-cp" },
    },
  );
});

test("контрагент, который нельзя менять, не подменяется во втором проходе", () => {
  const byText = rule({
    id: "by-text",
    conditions: [{ field: "description", op: "contains", value: "сбп" }],
    actions: { counterparty_id: "cp-t" },
  });
  const byCounterparty = rule({
    id: "by-cp",
    conditions: [{ field: "counterparty", op: "in", ids: ["cp-t"] }],
    actions: { category_id: "cat-fee" },
  });
  assert.deepEqual(
    evaluatePostingRules(
      [byText, byCounterparty],
      subject({ description: "Комиссия СБП", counterparty_id: "cp-a" }),
      ctx(),
      { ...ALL, counterparty_id: false },
    ),
    {},
  );
});

test("заведение вне доступных пропускается, статья из того же правила остаётся", () => {
  const r = rule({
    conditions: [{ field: "bank_account", op: "in", ids: ["acc-sber"] }],
    actions: { category_id: "cat-supply", venue_id: "v-other" },
  });
  assert.deepEqual(
    evaluatePostingRules([r], subject(), ctx({ allowedVenueIds: new Set(["v-mine"]) }), ALL),
    { category_id: { value: "cat-supply", ruleId: r.id } },
  );
});

test("статья другого типа не подставляется, смешанная подходит к обоим", () => {
  const cond = [{ field: "bank_account" as const, op: "in" as const, ids: ["acc-sber"] }];
  const revenue = rule({ conditions: cond, actions: { category_id: "cat-revenue" } });
  assert.deepEqual(evaluatePostingRules([revenue], subject({ type: "expense" }), ctx(), ALL), {});
  const mixed = rule({ conditions: cond, actions: { category_id: "cat-mixed" } });
  assert.deepEqual(evaluatePostingRules([mixed], subject({ type: "income" }), ctx(), ALL), {
    category_id: { value: "cat-mixed", ruleId: mixed.id },
  });
});

test("если первое правило не может поставить статью, её ставит следующее", () => {
  const cond = [{ field: "bank_account" as const, op: "in" as const, ids: ["acc-sber"] }];
  const wrongType = rule({ id: "wrong", position: 1, conditions: cond, actions: { category_id: "cat-revenue" } });
  const right = rule({ id: "right", position: 2, conditions: cond, actions: { category_id: "cat-supply" } });
  assert.deepEqual(evaluatePostingRules([wrongType, right], subject(), ctx(), ALL), {
    category_id: { value: "cat-supply", ruleId: "right" },
  });
});
