import test from "node:test";
import assert from "node:assert/strict";

import type { KbProperty } from "../../types/knowledge.ts";

import {
  findPropertyForCollectionField,
  type KbCollectionField,
} from "./collection.ts";

function field(
  id: string,
  type: KbCollectionField["type"] = "text",
  name?: string,
): KbCollectionField {
  return { id, name: name ?? id, type };
}

function scopedProperty(
  fieldId: string,
  collectionId: string,
  value: string,
  patch: Partial<Extract<KbProperty, { type: "text" }>> = {},
): KbProperty {
  return {
    id: `p_${collectionId}_${fieldId}`,
    name: fieldId,
    type: "text",
    value,
    scope: { type: "collection", collectionId, fieldId },
    ...patch,
  } as KbProperty;
}

// ───────────── happy path: exact (collectionId, fieldId) match ──────────────

test("findPropertyForCollectionField: returns property with matching scope", () => {
  const f = field("name");
  const properties = [scopedProperty("name", "c1", "Alpha")];
  const found = findPropertyForCollectionField(properties, f, "c1");
  assert.equal(found?.value, "Alpha");
});

// ───────────── cross-collection isolation: the real bug ─────────────────────

test("findPropertyForCollectionField: does not leak property across collections sharing fieldId", () => {
  const f = field("status");
  // Page has two collections, both with a "status" field.
  // Querying for c2 must NOT return c1's value.
  const properties = [
    scopedProperty("status", "c1", "Open"),
    scopedProperty("status", "c2", "Closed"),
  ];
  assert.equal(
    findPropertyForCollectionField(properties, f, "c2")?.value,
    "Closed",
  );
  assert.equal(
    findPropertyForCollectionField(properties, f, "c1")?.value,
    "Open",
  );
});

test("findPropertyForCollectionField: returns null when only foreign-collection property exists", () => {
  const f = field("status");
  // Only c1 has data; we ask for c2 — should not silently match c1.
  const properties = [scopedProperty("status", "c1", "Open")];
  assert.equal(findPropertyForCollectionField(properties, f, "c2"), null);
});

test("findPropertyForCollectionField: does not leak across collections via (name + type) fallback", () => {
  // fieldIds differ but name + type match — fallback 4 used to leak
  // across collections.
  const f = field("status_new", "text", "Status");
  const properties = [
    scopedProperty("status_old", "c1", "Open", {
      name: "Status",
    }),
  ];
  assert.equal(findPropertyForCollectionField(properties, f, "c2"), null);
});

// ───────────── legacy unscoped property: by-id match (kept) ─────────────────

test("findPropertyForCollectionField: matches legacy unscoped property by id", () => {
  const f = field("legacy_field_id");
  // Property has no scope at all — old data before collections existed.
  const property: KbProperty = {
    id: "legacy_field_id",
    name: "Legacy",
    type: "text",
    value: "kept",
  };
  assert.equal(
    findPropertyForCollectionField([property], f, "c1")?.value,
    "kept",
  );
});

// ───────────── recovery fallback within same collection ─────────────────────

test("findPropertyForCollectionField: name+type fallback inside same collection still works", () => {
  // Field id changed (e.g. schema migration), but property still
  // matches by (name, type) within the same collection — that recovery
  // path is preserved.
  const f = field("new_id", "text", "Status");
  const drifted = scopedProperty("old_id", "c1", "Open", {
    name: "Status",
  });
  const found = findPropertyForCollectionField([drifted], f, "c1");
  assert.equal(found?.value, "Open");
});
