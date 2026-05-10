import test from "node:test";
import assert from "node:assert/strict";

import {
  createCollectionSort,
  sortCollectionItems,
  type KbCollectionSortableItem,
  type KbCollectionSortField,
} from "./collection-sort.ts";

const fields: KbCollectionSortField[] = [
  { id: "score", name: "Score", type: "number" },
];

const items: KbCollectionSortableItem[] = [
  {
    id: "a",
    title: "Alpha",
    position: 2,
    updated_at: null,
    properties: [
      {
        id: "pa",
        name: "Score",
        type: "number",
        value: 20,
        scope: { type: "collection", collectionId: "collection", fieldId: "score" },
      },
    ],
  },
  {
    id: "b",
    title: "Beta",
    position: 1,
    updated_at: null,
    properties: [
      {
        id: "pb",
        name: "Score",
        type: "number",
        value: 10,
        scope: { type: "collection", collectionId: "collection", fieldId: "score" },
      },
    ],
  },
  {
    id: "c",
    title: "Gamma",
    position: 3,
    updated_at: null,
    properties: [],
  },
];

test("sortCollectionItems sorts by numeric collection property", () => {
  const sorted = sortCollectionItems(items, fields, [
    createCollectionSort("score", "asc"),
  ]);

  assert.deepEqual(
    sorted.map((item) => item.id),
    ["b", "a", "c"],
  );
});
