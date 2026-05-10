import test from "node:test";
import assert from "node:assert/strict";

import {
  createCollectionGrouping,
  groupCollectionItems,
  type KbCollectionGroupField,
  type KbCollectionGroupableItem,
} from "./collection-group.ts";

const collectionId = "collection";

const fields: KbCollectionGroupField[] = [
  { id: "status", name: "Status", type: "select" },
  { id: "team", name: "Team", type: "multi-select" },
  { id: "done", name: "Done", type: "checkbox" },
  { id: "note", name: "Note", type: "text" },
];

function item(
  id: string,
  properties: KbCollectionGroupableItem["properties"],
): KbCollectionGroupableItem {
  return {
    id,
    title: id,
    position: 0,
    updated_at: null,
    properties,
  };
}

function property(
  fieldId: string,
  type: KbCollectionGroupField["type"],
  value: KbCollectionGroupableItem["properties"][number]["value"],
): KbCollectionGroupableItem["properties"][number] {
  return {
    id: `${fieldId}-${String(value)}`,
    name: fieldId,
    type,
    value,
    scope: { type: "collection", collectionId, fieldId },
  } as KbCollectionGroupableItem["properties"][number];
}

test("groupCollectionItems groups by select and leaves empty values last", () => {
  const groups = groupCollectionItems(
    [
      item("b", [property("status", "select", "Backlog")]),
      item("a", [property("status", "select", "Active")]),
      item("empty", []),
    ],
    fields,
    createCollectionGrouping("status", "asc"),
    collectionId,
  );

  assert.deepEqual(
    groups.map((group) => [group.label, group.items.map((row) => row.id)]),
    [
      ["Active", ["a"]],
      ["Backlog", ["b"]],
      ["Без значения", ["empty"]],
    ],
  );
});

test("groupCollectionItems groups text values and preserves input order inside groups", () => {
  const groups = groupCollectionItems(
    [
      item("first", [property("note", "text", "Same")]),
      item("second", [property("note", "text", "Same")]),
      item("other", [property("note", "text", "Other")]),
    ],
    fields,
    createCollectionGrouping("note", "asc"),
    collectionId,
  );

  assert.deepEqual(
    groups.map((group) => [group.label, group.items.map((row) => row.id)]),
    [
      ["Other", ["other"]],
      ["Same", ["first", "second"]],
    ],
  );
});

test("groupCollectionItems uses checkbox labels", () => {
  const groups = groupCollectionItems(
    [
      item("yes", [property("done", "checkbox", true)]),
      item("no", [property("done", "checkbox", false)]),
    ],
    fields,
    createCollectionGrouping("done", "desc"),
    collectionId,
  );

  assert.deepEqual(
    groups.map((group) => group.label),
    ["Включено", "Выключено"],
  );
});

test("groupCollectionItems puts multi-select records into each selected group", () => {
  const groups = groupCollectionItems(
    [
      item("shared", [property("team", "multi-select", ["Design", "Ops"])]),
      item("none", [property("team", "multi-select", [])]),
    ],
    fields,
    createCollectionGrouping("team", "asc"),
    collectionId,
  );

  assert.deepEqual(
    groups.map((group) => [group.label, group.items.map((row) => row.id)]),
    [
      ["Design", ["shared"]],
      ["Ops", ["shared"]],
      ["Без значения", ["none"]],
    ],
  );
});
