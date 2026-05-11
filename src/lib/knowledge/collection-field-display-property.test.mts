import test from "node:test";
import assert from "node:assert/strict";

import type { KbProperty } from "../../types/knowledge.ts";

import { type KbCollectionField } from "./collection.ts";
import { collectionFieldDisplayProperty } from "./collection-fields.ts";

const context = { collectionId: "c1", collectionTitle: "Tasks" };

function field<T extends KbCollectionField["type"]>(
  id: string,
  type: T,
  patch: Partial<KbCollectionField> = {},
): KbCollectionField {
  return { id, name: id, type, ...patch };
}

// ──────────────── fallback when property is missing ────────────────

test("returns fallback for null property", () => {
  const result = collectionFieldDisplayProperty(null, field("t", "text"), context);
  assert.equal(result.id, "t");
  assert.equal(result.name, "t");
  assert.equal(result.type, "text");
  assert.deepEqual(result.scope, {
    type: "collection",
    collectionId: "c1",
    collectionTitle: "Tasks",
    fieldId: "t",
  });
  if (result.type === "text") assert.equal(result.value, "");
});

test("returns fallback when property type drifted from field type", () => {
  // Stored as "text" but field re-typed to "number" — fallback used.
  const drifted: KbProperty = {
    id: "drifted",
    name: "drifted",
    type: "text",
    value: "lost",
  };
  const result = collectionFieldDisplayProperty(
    drifted,
    field("n", "number"),
    context,
  );
  assert.equal(result.type, "number");
  if (result.type === "number") assert.equal(result.value, null);
});

// ──────────────── identity overrides ────────────────────────────────

test("rewrites id/name/scope from fallback even when types match", () => {
  // Stored property keeps value but acquires field's id/name/scope.
  const stored: KbProperty = {
    id: "old_id",
    name: "Old Name",
    type: "text",
    value: "Hello",
    scope: { type: "page" },
  };
  const result = collectionFieldDisplayProperty(
    stored,
    field("new_id", "text", { name: "New Name" }),
    context,
  );
  assert.equal(result.id, "new_id");
  assert.equal(result.name, "New Name");
  assert.deepEqual(result.scope, {
    type: "collection",
    collectionId: "c1",
    collectionTitle: "Tasks",
    fieldId: "new_id",
  });
  if (result.type === "text") assert.equal(result.value, "Hello");
});

test("propagates description / icon / iconColor from field", () => {
  const stored: KbProperty = {
    id: "f",
    name: "f",
    type: "text",
    value: "v",
  };
  const f = field("f", "text", {
    description: "Field-level help",
    icon: "📎",
    iconColor: "amber",
  });
  const result = collectionFieldDisplayProperty(stored, f, context);
  assert.equal(result.description, "Field-level help");
  assert.equal(result.icon, "📎");
  assert.equal(result.iconColor, "amber");
});

// ──────────────── number: displayVariant=rating ─────────────────────

test("number → rating variant: copies max, drops unit, applies ratingVariant", () => {
  const stored: KbProperty = {
    id: "n",
    name: "n",
    type: "number",
    value: 4,
    unit: { kind: "currency", code: "USD" },
  };
  const f = field("n", "number", {
    displayVariant: "rating",
    max: 10,
    ratingVariant: "slider",
    ratingShowValue: false,
  });
  const result = collectionFieldDisplayProperty(stored, f, context);
  assert.equal(result.type, "number");
  if (result.type !== "number") return;
  assert.equal(result.displayVariant, "rating");
  assert.equal(result.max, 10);
  assert.equal(result.ratingVariant, "slider");
  assert.equal(result.ratingShowValue, false);
  // unit must be stripped — rating-mode doesn't carry it.
  assert.equal(result.unit, undefined);
  assert.equal(result.value, 4);
});

test("number → rating variant: max defaults to 5 if field.max not set", () => {
  const stored: KbProperty = {
    id: "n",
    name: "n",
    type: "number",
    value: 3,
  };
  const f = field("n", "number", { displayVariant: "rating" });
  const result = collectionFieldDisplayProperty(stored, f, context);
  if (result.type !== "number") return;
  assert.equal(result.max, 5);
});

test("number → rating: stars variant clears ratingVariant key", () => {
  const stored = {
    id: "n",
    name: "n",
    type: "number" as const,
    value: 2,
    ratingVariant: "slider" as const,
    ratingShowValue: false as const,
  };
  const f = field("n", "number", {
    displayVariant: "rating",
    ratingVariant: "stars",
    ratingShowValue: true,
  });
  const result = collectionFieldDisplayProperty(stored, f, context);
  if (result.type !== "number") return;
  // ratingVariant === "stars" → key absent (default)
  assert.equal(result.ratingVariant, undefined);
  // ratingShowValue === true → key absent (default)
  assert.equal(result.ratingShowValue, undefined);
});

test("number → plain: strips rating-related keys", () => {
  const stored = {
    id: "n",
    name: "n",
    type: "number" as const,
    value: 7,
    displayVariant: "rating" as const,
    max: 10 as const,
    ratingVariant: "slider" as const,
    ratingShowValue: false as const,
  };
  const f = field("n", "number", { displayVariant: undefined });
  const result = collectionFieldDisplayProperty(stored, f, context);
  if (result.type !== "number") return;
  assert.equal(result.displayVariant, undefined);
  assert.equal(result.max, undefined);
  assert.equal(result.ratingVariant, undefined);
  assert.equal(result.ratingShowValue, undefined);
  assert.equal(result.value, 7);
});

// ──────────────── checkbox: displayVariant=switch ───────────────────

test("checkbox: applies switch variant from field, strips stored one", () => {
  const stored = {
    id: "c",
    name: "c",
    type: "checkbox" as const,
    value: true,
    displayVariant: "checkbox" as const,
  };
  const f = field("c", "checkbox", { displayVariant: "switch" });
  const result = collectionFieldDisplayProperty(stored, f, context);
  if (result.type !== "checkbox") return;
  assert.equal(result.displayVariant, "switch");
  assert.equal(result.value, true);
});

test("checkbox: no displayVariant when field is plain", () => {
  const stored = {
    id: "c",
    name: "c",
    type: "checkbox" as const,
    value: false,
    displayVariant: "switch" as const,
  };
  const f = field("c", "checkbox");
  const result = collectionFieldDisplayProperty(stored, f, context);
  if (result.type !== "checkbox") return;
  // Stored displayVariant=switch must be stripped because field has none.
  assert.equal(result.displayVariant, undefined);
});

// ──────────────── text: collapsed flag ──────────────────────────────

test("text: collapsed flag propagates from field, stored value preserved", () => {
  const stored: Extract<KbProperty, { type: "text" }> = {
    id: "t",
    name: "t",
    type: "text",
    value: "Hello world",
    collapsed: false,
  };
  const f = field("t", "text", { collapsed: true });
  const result = collectionFieldDisplayProperty(stored, f, context);
  if (result.type !== "text") return;
  assert.equal(result.collapsed, true);
  assert.equal(result.value, "Hello world");
});

test("text: collapsed=false on field strips stored collapsed key", () => {
  const stored: Extract<KbProperty, { type: "text" }> = {
    id: "t",
    name: "t",
    type: "text",
    value: "x",
    collapsed: true,
  };
  const f = field("t", "text", { collapsed: false });
  const result = collectionFieldDisplayProperty(stored, f, context);
  if (result.type !== "text") return;
  assert.equal(result.collapsed, undefined);
});

// ──────────────── url: urlCollapsed flag ────────────────────────────

test("url: urlCollapsed flag propagates from field", () => {
  const stored: Extract<KbProperty, { type: "url" }> = {
    id: "u",
    name: "u",
    type: "url",
    value: "https://example.com",
  };
  const f = field("u", "url", { urlCollapsed: true });
  const result = collectionFieldDisplayProperty(stored, f, context);
  if (result.type !== "url") return;
  assert.equal(result.urlCollapsed, true);
  assert.equal(result.value, "https://example.com");
});

// ──────────────── rating type ───────────────────────────────────────

test("rating: copies max, ratingVariant=slider sets displayVariant=slider", () => {
  const stored: Extract<KbProperty, { type: "rating" }> = {
    id: "r",
    name: "r",
    type: "rating",
    value: 3,
  };
  const f = field("r", "rating", {
    max: 10,
    ratingVariant: "slider",
    ratingShowValue: false,
  });
  const result = collectionFieldDisplayProperty(stored, f, context);
  if (result.type !== "rating") return;
  assert.equal(result.max, 10);
  assert.equal(result.displayVariant, "slider");
  assert.equal(result.ratingShowValue, false);
  assert.equal(result.value, 3);
});

test("rating: stars variant doesn't set displayVariant key", () => {
  const stored: Extract<KbProperty, { type: "rating" }> = {
    id: "r",
    name: "r",
    type: "rating",
    value: 4,
    displayVariant: "slider",
  };
  const f = field("r", "rating", { ratingVariant: "stars" });
  const result = collectionFieldDisplayProperty(stored, f, context);
  if (result.type !== "rating") return;
  // Stored displayVariant must be discarded; field doesn't request slider.
  assert.equal(result.displayVariant, undefined);
});

// ──────────────── catch-all (date, select, multi-select) ─────────────

test("date: keeps stored value, only rewrites id/name/scope", () => {
  const stored: Extract<KbProperty, { type: "date" }> = {
    id: "d",
    name: "d",
    type: "date",
    value: "2026-05-11",
  };
  const f = field("new_d", "date", { name: "Дедлайн" });
  const result = collectionFieldDisplayProperty(stored, f, context);
  assert.equal(result.id, "new_d");
  assert.equal(result.name, "Дедлайн");
  if (result.type !== "date") return;
  assert.equal(result.value, "2026-05-11");
});

test("select: keeps options array, rewrites identity", () => {
  const stored: Extract<KbProperty, { type: "select" }> = {
    id: "s",
    name: "s",
    type: "select",
    value: "Active",
    options: ["Active", "Done"],
  };
  const f = field("new_s", "select");
  const result = collectionFieldDisplayProperty(stored, f, context);
  if (result.type !== "select") return;
  assert.equal(result.id, "new_s");
  assert.deepEqual(result.options, ["Active", "Done"]);
  assert.equal(result.value, "Active");
});

test("multi-select: keeps options + value array", () => {
  const stored: Extract<KbProperty, { type: "multi-select" }> = {
    id: "m",
    name: "m",
    type: "multi-select",
    value: ["A", "C"],
    options: ["A", "B", "C"],
  };
  const f = field("m", "multi-select");
  const result = collectionFieldDisplayProperty(stored, f, context);
  if (result.type !== "multi-select") return;
  assert.deepEqual(result.value, ["A", "C"]);
  assert.deepEqual(result.options, ["A", "B", "C"]);
});
