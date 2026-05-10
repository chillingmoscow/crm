import test from "node:test";
import assert from "node:assert/strict";

import type { KbProperty } from "../../types/knowledge.ts";

import type {
  KbCollectionField,
  KbCollectionFilter,
  KbCollectionFilterOperator,
} from "./collection.ts";
import {
  defaultFilterOperator,
  filterCollectionItems,
  filterOperatorNeedsValue,
  filterOperatorsForField,
  isFilterValueEmpty,
  matchesCollectionFilter,
  normalizeFilterInputValue,
  normalizeFilterOperatorForField,
} from "./collection-filter.ts";

const collectionId = "collection";

function field(
  id: string,
  type: KbCollectionField["type"],
  patch: Partial<KbCollectionField> = {},
): KbCollectionField {
  return { id, name: id, type, ...patch };
}

function filter(
  fieldId: string,
  operator: KbCollectionFilterOperator,
  value?: KbCollectionFilter["value"],
): KbCollectionFilter {
  return { id: `f_${fieldId}_${operator}`, fieldId, operator, value };
}

function property(
  fieldId: string,
  type: KbProperty["type"],
  value: unknown,
): KbProperty {
  return {
    id: `p_${fieldId}`,
    name: fieldId,
    type,
    value,
    scope: { type: "collection", collectionId, fieldId },
  } as KbProperty;
}

// ───────────────────────────── isFilterValueEmpty ────────────────────────────

test("isFilterValueEmpty: null / empty string / empty array are empty", () => {
  assert.equal(isFilterValueEmpty(null), true);
  assert.equal(isFilterValueEmpty(""), true);
  assert.equal(isFilterValueEmpty([]), true);
});

test("isFilterValueEmpty: zero, false, non-empty values are NOT empty", () => {
  assert.equal(isFilterValueEmpty(0), false);
  assert.equal(isFilterValueEmpty(false), false);
  assert.equal(isFilterValueEmpty("x"), false);
  assert.equal(isFilterValueEmpty(["a"]), false);
});

// ─────────────────────────── defaultFilterOperator ───────────────────────────

test("defaultFilterOperator picks sensible operator per field type", () => {
  assert.equal(defaultFilterOperator(field("c", "checkbox")), "is_checked");
  assert.equal(defaultFilterOperator(field("t", "text")), "contains");
  assert.equal(defaultFilterOperator(field("u", "url")), "contains");
  assert.equal(defaultFilterOperator(field("m", "multi-select")), "contains");
  assert.equal(defaultFilterOperator(field("n", "number")), "equals");
  assert.equal(defaultFilterOperator(field("r", "rating")), "equals");
  assert.equal(defaultFilterOperator(field("d", "date")), "equals");
  assert.equal(defaultFilterOperator(field("s", "select")), "equals");
});

// ─────────────────────────── filterOperatorsForField ─────────────────────────

test("filterOperatorsForField: checkbox returns only checked/unchecked", () => {
  const ops = filterOperatorsForField(field("c", "checkbox")).map((o) => o.value);
  assert.deepEqual(ops, ["is_checked", "is_unchecked"]);
});

test("filterOperatorsForField: number/rating include comparison operators", () => {
  for (const type of ["number", "rating"] as const) {
    const ops = filterOperatorsForField(field("x", type)).map((o) => o.value);
    assert.deepEqual(ops, [
      "equals",
      "not_equals",
      "greater_than",
      "less_than",
      "is_empty",
      "is_not_empty",
    ]);
  }
});

test("filterOperatorsForField: text/url/multi-select use contains", () => {
  for (const type of ["text", "url", "multi-select"] as const) {
    const ops = filterOperatorsForField(field("x", type)).map((o) => o.value);
    assert.deepEqual(ops, [
      "contains",
      "not_contains",
      "is_empty",
      "is_not_empty",
    ]);
  }
});

// ────────────────────── normalizeFilterOperatorForField ──────────────────────

test("normalizeFilterOperatorForField returns the default when operator is incompatible", () => {
  // text field doesn't support greater_than → falls back to default (contains)
  assert.equal(
    normalizeFilterOperatorForField(field("t", "text"), "greater_than"),
    "contains",
  );
  // number field supports equals — keep it
  assert.equal(
    normalizeFilterOperatorForField(field("n", "number"), "equals"),
    "equals",
  );
});

// ───────────────────────── filterOperatorNeedsValue ──────────────────────────

test("filterOperatorNeedsValue: checkbox operators do not need a value", () => {
  assert.equal(
    filterOperatorNeedsValue(field("c", "checkbox"), "is_checked"),
    false,
  );
  assert.equal(
    filterOperatorNeedsValue(field("c", "checkbox"), "is_unchecked"),
    false,
  );
});

test("filterOperatorNeedsValue: is_empty/is_not_empty never need a value", () => {
  assert.equal(filterOperatorNeedsValue(field("t", "text"), "is_empty"), false);
  assert.equal(
    filterOperatorNeedsValue(field("n", "number"), "is_not_empty"),
    false,
  );
});

test("filterOperatorNeedsValue: other operators need a value", () => {
  assert.equal(filterOperatorNeedsValue(field("t", "text"), "contains"), true);
  assert.equal(filterOperatorNeedsValue(field("n", "number"), "equals"), true);
});

// ─────────────────────────── normalizeFilterInputValue ───────────────────────

test("normalizeFilterInputValue: non-numeric field returns the raw string", () => {
  assert.equal(normalizeFilterInputValue(field("t", "text"), "hello"), "hello");
});

test("normalizeFilterInputValue: numeric field parses numbers", () => {
  assert.equal(normalizeFilterInputValue(field("n", "number"), "42"), 42);
  assert.equal(normalizeFilterInputValue(field("r", "rating"), "3.5"), 3.5);
});

test("normalizeFilterInputValue: blank input on numeric field returns empty string", () => {
  assert.equal(normalizeFilterInputValue(field("n", "number"), ""), "");
  assert.equal(normalizeFilterInputValue(field("n", "number"), "   "), "");
});

test("normalizeFilterInputValue: non-numeric input on numeric field returns raw string", () => {
  assert.equal(normalizeFilterInputValue(field("n", "number"), "abc"), "abc");
});

// ─────────────────────────── matchesCollectionFilter ─────────────────────────

test("matchesCollectionFilter: is_empty / is_not_empty handle nullish values", () => {
  const f = field("t", "text");
  const empty = property("t", "text", "");
  const filled = property("t", "text", "hi");
  assert.equal(matchesCollectionFilter(empty, f, filter("t", "is_empty")), true);
  assert.equal(matchesCollectionFilter(filled, f, filter("t", "is_empty")), false);
  assert.equal(
    matchesCollectionFilter(null, f, filter("t", "is_not_empty")),
    false,
  );
  assert.equal(
    matchesCollectionFilter(filled, f, filter("t", "is_not_empty")),
    true,
  );
});

test("matchesCollectionFilter: is_checked / is_unchecked respect boolean value", () => {
  const f = field("c", "checkbox");
  const truthy = property("c", "checkbox", true);
  const falsy = property("c", "checkbox", false);
  assert.equal(matchesCollectionFilter(truthy, f, filter("c", "is_checked")), true);
  assert.equal(matchesCollectionFilter(falsy, f, filter("c", "is_checked")), false);
  assert.equal(
    matchesCollectionFilter(null, f, filter("c", "is_unchecked")),
    true,
  );
  assert.equal(
    matchesCollectionFilter(truthy, f, filter("c", "is_unchecked")),
    false,
  );
});

test("matchesCollectionFilter: contains is case-insensitive and trims needle", () => {
  const f = field("t", "text");
  const prop = property("t", "text", "Hello World");
  assert.equal(
    matchesCollectionFilter(prop, f, filter("t", "contains", "  WORLD ")),
    true,
  );
  assert.equal(
    matchesCollectionFilter(prop, f, filter("t", "contains", "absent")),
    false,
  );
});

test("matchesCollectionFilter: contains on multi-select matches any option", () => {
  const f = field("m", "multi-select");
  const prop = property("m", "multi-select", ["Alpha", "Beta"]);
  assert.equal(
    matchesCollectionFilter(prop, f, filter("m", "contains", "alpha")),
    true,
  );
  assert.equal(
    matchesCollectionFilter(prop, f, filter("m", "not_contains", "gamma")),
    true,
  );
  assert.equal(
    matchesCollectionFilter(prop, f, filter("m", "not_contains", "BETA")),
    false,
  );
});

test("matchesCollectionFilter: empty needle for contains returns true (no-op)", () => {
  const f = field("t", "text");
  const prop = property("t", "text", "anything");
  assert.equal(matchesCollectionFilter(prop, f, filter("t", "contains", "")), true);
  assert.equal(
    matchesCollectionFilter(prop, f, filter("t", "not_contains", "  ")),
    true,
  );
});

test("matchesCollectionFilter: equals/not_equals on numbers compare numerically", () => {
  const f = field("n", "number");
  const prop = property("n", "number", 42);
  assert.equal(matchesCollectionFilter(prop, f, filter("n", "equals", 42)), true);
  assert.equal(
    matchesCollectionFilter(prop, f, filter("n", "equals", "42")),
    true,
  );
  assert.equal(matchesCollectionFilter(prop, f, filter("n", "equals", 7)), false);
  assert.equal(
    matchesCollectionFilter(prop, f, filter("n", "not_equals", 7)),
    true,
  );
});

test("matchesCollectionFilter: equals on numeric fields returns false when either side empty", () => {
  const f = field("n", "number");
  const emptyProp = property("n", "number", null);
  assert.equal(matchesCollectionFilter(emptyProp, f, filter("n", "equals", 1)), false);
  assert.equal(
    matchesCollectionFilter(property("n", "number", 1), f, filter("n", "equals", null)),
    false,
  );
});

test("matchesCollectionFilter: equals/not_equals on text are case-insensitive and trimmed", () => {
  const f = field("s", "select");
  const prop = property("s", "select", "Done");
  assert.equal(
    matchesCollectionFilter(prop, f, filter("s", "equals", "  done  ")),
    true,
  );
  assert.equal(
    matchesCollectionFilter(prop, f, filter("s", "not_equals", "open")),
    true,
  );
});

test("matchesCollectionFilter: greater_than / less_than compare numbers", () => {
  const f = field("n", "number");
  const prop = property("n", "number", 5);
  assert.equal(matchesCollectionFilter(prop, f, filter("n", "greater_than", 3)), true);
  assert.equal(matchesCollectionFilter(prop, f, filter("n", "less_than", 10)), true);
  assert.equal(matchesCollectionFilter(prop, f, filter("n", "greater_than", 5)), false);
  // Empty filter value collapses to false
  assert.equal(
    matchesCollectionFilter(prop, f, filter("n", "greater_than", null)),
    false,
  );
});

// ────────────────────────── filterCollectionItems ────────────────────────────

test("filterCollectionItems: returns input untouched when no valid filters apply", () => {
  const fields = [field("t", "text")];
  const items = [{ properties: [property("t", "text", "foo")] }];
  // Filter referencing unknown field is dropped
  const result = filterCollectionItems(
    items,
    fields,
    [filter("missing", "contains", "foo")],
    collectionId,
  );
  assert.equal(result, items);
});

test("filterCollectionItems: AND-combines multiple filters", () => {
  const fields = [field("t", "text"), field("n", "number")];
  const items = [
    {
      id: "match",
      properties: [
        property("t", "text", "alpha"),
        property("n", "number", 10),
      ],
    },
    {
      id: "wrong-text",
      properties: [
        property("t", "text", "beta"),
        property("n", "number", 10),
      ],
    },
    {
      id: "wrong-number",
      properties: [
        property("t", "text", "alpha"),
        property("n", "number", 99),
      ],
    },
  ];
  const result = filterCollectionItems(
    items,
    fields,
    [filter("t", "contains", "alpha"), filter("n", "equals", 10)],
    collectionId,
  );
  assert.deepEqual(
    result.map((item) => item.id),
    ["match"],
  );
});

test("filterCollectionItems: missing property is treated as null", () => {
  const fields = [field("t", "text")];
  const items = [{ id: "empty", properties: [] }];
  const result = filterCollectionItems(
    items,
    fields,
    [filter("t", "is_empty")],
    collectionId,
  );
  assert.deepEqual(
    result.map((item) => item.id),
    ["empty"],
  );
});
