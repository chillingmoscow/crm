import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExclusionMatcher,
  groupDescendants,
  type ExclusionRuleRow,
  type GroupNode,
} from "./exclusion-rules.ts";

function rule(p: Partial<ExclusionRuleRow> & { id: string }): ExclusionRuleRow {
  return {
    target_kind: "product",
    ingredient_id: null,
    external_product_id: null,
    ingredient_group_id: null,
    product_name: "x",
    reason: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    ...p,
  };
}

// root <- mid <- leaf ; other (отдельное дерево)
const groups: GroupNode[] = [
  { id: "root", parent_group_id: null },
  { id: "mid", parent_group_id: "root" },
  { id: "leaf", parent_group_id: "mid" },
  { id: "other", parent_group_id: null },
];

const line = (o: Partial<{ ingredientId: string | null; externalProductId: string | null; groupId: string | null }>) => ({
  ingredientId: null,
  externalProductId: null,
  groupId: null,
  ...o,
});

test("matches product rule by ingredient id", () => {
  const m = buildExclusionMatcher([rule({ id: "r1", ingredient_id: "i1" })], groups);
  assert.equal(m(line({ ingredientId: "i1" }))?.id, "r1");
  assert.equal(m(line({ ingredientId: "i2" })), null);
});

test("falls back to external product id", () => {
  const m = buildExclusionMatcher([rule({ id: "r1", external_product_id: "e1" })], groups);
  assert.equal(m(line({ externalProductId: "e1" }))?.id, "r1");
  assert.equal(m(line({ ingredientId: "i1", externalProductId: "e1" }))?.id, "r1");
});

test("ingredient id match wins over external product id match", () => {
  const m = buildExclusionMatcher(
    [rule({ id: "byExt", external_product_id: "e1" }), rule({ id: "byIng", ingredient_id: "i1" })],
    groups,
  );
  assert.equal(m(line({ ingredientId: "i1", externalProductId: "e1" }))?.id, "byIng");
});

test("matches group rule for product in subgroup of subgroup", () => {
  const m = buildExclusionMatcher([rule({ id: "g", target_kind: "group", ingredient_group_id: "root" })], groups);
  assert.equal(m(line({ groupId: "leaf" }))?.id, "g");
  assert.equal(m(line({ groupId: "root" }))?.id, "g");
  assert.equal(m(line({ groupId: "other" })), null);
});

test("product rule wins over group rule", () => {
  const m = buildExclusionMatcher(
    [
      rule({ id: "g", target_kind: "group", ingredient_group_id: "root" }),
      rule({ id: "p", ingredient_id: "i1" }),
    ],
    groups,
  );
  assert.equal(m(line({ ingredientId: "i1", groupId: "leaf" }))?.id, "p");
});

test("nearest group wins over ancestor group", () => {
  const m = buildExclusionMatcher(
    [
      rule({ id: "far", target_kind: "group", ingredient_group_id: "root" }),
      rule({ id: "near", target_kind: "group", ingredient_group_id: "mid" }),
    ],
    groups,
  );
  assert.equal(m(line({ groupId: "leaf" }))?.id, "near");
});

test("legacy_name never matches", () => {
  const m = buildExclusionMatcher(
    [rule({ id: "l", target_kind: "legacy_name", ingredient_id: "i1", external_product_id: "e1", ingredient_group_id: "root" })],
    groups,
  );
  assert.equal(m(line({ ingredientId: "i1", externalProductId: "e1", groupId: "leaf" })), null);
});

test("cycle in parent chain does not hang", () => {
  const cyc: GroupNode[] = [
    { id: "A", parent_group_id: "B" },
    { id: "B", parent_group_id: "A" },
  ];
  const m = buildExclusionMatcher([rule({ id: "g", target_kind: "group", ingredient_group_id: "Z" })], cyc);
  assert.equal(m(line({ groupId: "A" })), null);
  assert.deepEqual([...groupDescendants("A", cyc)].sort(), ["A", "B"]);
});

test("null groupId matches only product rules", () => {
  const m = buildExclusionMatcher(
    [rule({ id: "g", target_kind: "group", ingredient_group_id: "root" }), rule({ id: "p", ingredient_id: "i1" })],
    groups,
  );
  assert.equal(m(line({ groupId: null })), null);
  assert.equal(m(line({ ingredientId: "i1", groupId: null }))?.id, "p");
});

test("groupDescendants includes self and all nested", () => {
  assert.deepEqual([...groupDescendants("root", groups)].sort(), ["leaf", "mid", "root"]);
});
