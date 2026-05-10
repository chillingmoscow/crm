import test from "node:test";
import assert from "node:assert/strict";

import {
  KB_COLLECTION_CREATABLE_FIELD_TYPES,
  KB_COLLECTION_DEFAULT_VISIBLE_FIELDS,
  KB_COLLECTION_EMPTY_SCHEMA,
  type KbCollectionField,
} from "./collection.ts";
import {
  buildLegacyCollectionBlocks,
  collectionFieldTypeOptions,
  getDocumentCollectionBlocks,
  insertCollectionFieldId,
  MIN_TABLE_COLUMN_WIDTH,
  minTableColumnWidthForField,
  orderCollectionFields,
  reorderCollectionFieldIds,
  walkDocumentBlocks,
  type CollectionDocumentBlock,
} from "./collection-fields.ts";

function field(
  id: string,
  patch: Partial<KbCollectionField> = {},
): KbCollectionField {
  return { id, name: id, type: "text", ...patch };
}

// ─────────────────────────── minTableColumnWidthForField ─────────────────────

test("minTableColumnWidthForField: text falls back to MIN_TABLE_COLUMN_WIDTH", () => {
  assert.equal(
    minTableColumnWidthForField(field("t", { type: "text" })),
    MIN_TABLE_COLUMN_WIDTH,
  );
});

test("minTableColumnWidthForField: checkbox is 96", () => {
  assert.equal(minTableColumnWidthForField(field("c", { type: "checkbox" })), 96);
});

test("minTableColumnWidthForField: rating slider variants", () => {
  assert.equal(
    minTableColumnWidthForField(
      field("r", { type: "rating", ratingVariant: "slider" }),
    ),
    190,
  );
  assert.equal(
    minTableColumnWidthForField(
      field("r", {
        type: "rating",
        ratingVariant: "slider",
        ratingShowValue: false,
      }),
    ),
    150,
  );
});

test("minTableColumnWidthForField: rating stars (default max=5) and large max", () => {
  // max=5 → max(112, 5*20 + 4*2 + 20) = max(112, 128) = 128
  assert.equal(minTableColumnWidthForField(field("r", { type: "rating" })), 128);
  // max=10 → max(112, 10*20 + 9*2 + 20) = max(112, 238) = 238
  assert.equal(
    minTableColumnWidthForField(field("r", { type: "rating", max: 10 })),
    238,
  );
  // max=3 → max(112, 3*20 + 2*2 + 20) = max(112, 84) = 112
  assert.equal(
    minTableColumnWidthForField(field("r", { type: "rating", max: 3 })),
    112,
  );
});

test("minTableColumnWidthForField: number with rating displayVariant uses same scale", () => {
  assert.equal(
    minTableColumnWidthForField(
      field("n", { type: "number", displayVariant: "rating", max: 5 }),
    ),
    128,
  );
});

// ─────────────────────────── collectionFieldTypeOptions ──────────────────────

test("collectionFieldTypeOptions: without current returns creatable defaults", () => {
  assert.deepEqual(
    collectionFieldTypeOptions(),
    KB_COLLECTION_CREATABLE_FIELD_TYPES,
  );
});

test("collectionFieldTypeOptions: appends current if not creatable", () => {
  // rating is in KB_COLLECTION_FIELD_TYPES but excluded from creatable
  const opts = collectionFieldTypeOptions("rating");
  assert.deepEqual(opts, [...KB_COLLECTION_CREATABLE_FIELD_TYPES, "rating"]);
});

test("collectionFieldTypeOptions: returns creatable as-is if current already in it", () => {
  assert.deepEqual(
    collectionFieldTypeOptions("text"),
    KB_COLLECTION_CREATABLE_FIELD_TYPES,
  );
});

// ──────────────────────────── orderCollectionFields ──────────────────────────

test("orderCollectionFields: null/empty order returns input unchanged", () => {
  const fields = [field("a"), field("b"), field("c")];
  assert.equal(orderCollectionFields(fields, null), fields);
  assert.equal(orderCollectionFields(fields, []), fields);
});

test("orderCollectionFields: respects given order", () => {
  const fields = [field("a"), field("b"), field("c")];
  const result = orderCollectionFields(fields, ["c", "a", "b"]);
  assert.deepEqual(
    result.map((f) => f.id),
    ["c", "a", "b"],
  );
});

test("orderCollectionFields: appends fields missing from the order list", () => {
  const fields = [field("a"), field("b"), field("c"), field("d")];
  const result = orderCollectionFields(fields, ["c", "a"]);
  assert.deepEqual(
    result.map((f) => f.id),
    ["c", "a", "b", "d"],
  );
});

test("orderCollectionFields: silently skips order ids not in field set and dedupes", () => {
  const fields = [field("a"), field("b")];
  const result = orderCollectionFields(fields, ["a", "ghost", "a", "b"]);
  assert.deepEqual(
    result.map((f) => f.id),
    ["a", "b"],
  );
});

// ─────────────────────────── reorderCollectionFieldIds ───────────────────────

test("reorderCollectionFieldIds: moves field before target", () => {
  const fields = [field("a"), field("b"), field("c"), field("d")];
  const next = reorderCollectionFieldIds(fields, null, "d", "b", "before");
  assert.deepEqual(next, ["a", "d", "b", "c"]);
});

test("reorderCollectionFieldIds: moves field after target", () => {
  const fields = [field("a"), field("b"), field("c"), field("d")];
  const next = reorderCollectionFieldIds(fields, null, "a", "c", "after");
  assert.deepEqual(next, ["b", "c", "a", "d"]);
});

test("reorderCollectionFieldIds: returns null when activeId is missing", () => {
  const fields = [field("a"), field("b")];
  assert.equal(
    reorderCollectionFieldIds(fields, null, "ghost", "a", "before"),
    null,
  );
});

test("reorderCollectionFieldIds: returns null when targetId is missing", () => {
  const fields = [field("a"), field("b")];
  assert.equal(
    reorderCollectionFieldIds(fields, null, "a", "ghost", "before"),
    null,
  );
});

test("reorderCollectionFieldIds: works against an explicit prior order", () => {
  const fields = [field("a"), field("b"), field("c")];
  const next = reorderCollectionFieldIds(fields, ["c", "b", "a"], "a", "c", "before");
  assert.deepEqual(next, ["a", "c", "b"]);
});

// ──────────────────────────── insertCollectionFieldId ────────────────────────

test("insertCollectionFieldId: inserts before target", () => {
  const fields = [field("a"), field("b"), field("c")];
  const next = insertCollectionFieldId(fields, null, "new", "b", "before");
  assert.deepEqual(next, ["a", "new", "b", "c"]);
});

test("insertCollectionFieldId: inserts after target", () => {
  const fields = [field("a"), field("b"), field("c")];
  const next = insertCollectionFieldId(fields, null, "new", "b", "after");
  assert.deepEqual(next, ["a", "b", "new", "c"]);
});

test("insertCollectionFieldId: appends to end when target is missing", () => {
  const fields = [field("a"), field("b")];
  const next = insertCollectionFieldId(fields, null, "new", "ghost", "after");
  assert.deepEqual(next, ["a", "b", "new"]);
});

test("insertCollectionFieldId: dedupes if newFieldId already present in order", () => {
  const fields = [field("a"), field("b"), field("c")];
  const next = insertCollectionFieldId(fields, ["a", "b", "c"], "b", "c", "after");
  // 'b' should be removed from its existing position and re-inserted
  assert.deepEqual(next, ["a", "c", "b"]);
});

// ──────────────────────────── walkDocumentBlocks ─────────────────────────────

test("walkDocumentBlocks: visits all blocks depth-first", () => {
  const blocks: CollectionDocumentBlock[] = [
    { id: "1", type: "paragraph" },
    {
      id: "2",
      type: "paragraph",
      children: [
        { id: "2.1", type: "paragraph" },
        {
          id: "2.2",
          type: "paragraph",
          children: [{ id: "2.2.1", type: "paragraph" }],
        },
      ],
    },
    { id: "3", type: "paragraph" },
  ];
  const visited: string[] = [];
  walkDocumentBlocks(blocks, (block) => visited.push(block.id));
  assert.deepEqual(visited, ["1", "2", "2.1", "2.2", "2.2.1", "3"]);
});

// ────────────────────────── getDocumentCollectionBlocks ──────────────────────

test("getDocumentCollectionBlocks: returns empty when editor.document is not an array", () => {
  assert.deepEqual(getDocumentCollectionBlocks({}), []);
  assert.deepEqual(getDocumentCollectionBlocks({ document: null }), []);
  assert.deepEqual(getDocumentCollectionBlocks("not-an-editor"), []);
});

test("getDocumentCollectionBlocks: collects collection blocks from a nested document", () => {
  const editor = {
    document: [
      { id: "p1", type: "paragraph" },
      {
        id: "c1",
        type: "collection",
        props: { title: "Outer" },
      },
      {
        id: "p2",
        type: "paragraph",
        children: [
          {
            id: "c2",
            type: "collection",
            props: { title: "Inner" },
          },
        ],
      },
    ],
  };
  const blocks = getDocumentCollectionBlocks(editor);
  assert.deepEqual(
    blocks.map((block) => block.id),
    ["c1", "c2"],
  );
});

// ─────────────────────────── buildLegacyCollectionBlocks ─────────────────────

test("buildLegacyCollectionBlocks: produces full legacy descriptors with defaults", () => {
  const editor = {
    document: [
      {
        id: "c1",
        type: "collection",
        props: {
          title: "Tasks",
          view: "table",
          viewTitle: "By Owner",
          schemaJson: '{"version":1,"fields":[{"id":"x"}]}',
          visibleFieldIdsJson: '["x"]',
          fieldOrderIdsJson: '["x"]',
        },
      },
    ],
  };
  const legacy = buildLegacyCollectionBlocks(editor);
  assert.deepEqual(legacy, [
    {
      blockId: "c1",
      title: "Tasks",
      view: "table",
      viewTitle: "By Owner",
      schemaJson: '{"version":1,"fields":[{"id":"x"}]}',
      visibleFieldIdsJson: '["x"]',
      fieldOrderIdsJson: '["x"]',
    },
  ]);
});

test("buildLegacyCollectionBlocks: falls back to default constants when props are missing or wrong type", () => {
  const editor = {
    document: [
      {
        id: "c1",
        type: "collection",
        props: {
          title: 123, // wrong type → undefined
          view: "bogus", // invalid → normalized
          // schemaJson missing
          visibleFieldIdsJson: null,
        },
      },
    ],
  };
  const legacy = buildLegacyCollectionBlocks(editor);
  assert.equal(legacy[0].blockId, "c1");
  assert.equal(legacy[0].title, undefined);
  // normalizeCollectionViewType returns "list" for unknown
  assert.equal(legacy[0].view, "list");
  assert.equal(legacy[0].viewTitle, undefined);
  assert.equal(legacy[0].schemaJson, KB_COLLECTION_EMPTY_SCHEMA);
  assert.equal(
    legacy[0].visibleFieldIdsJson,
    KB_COLLECTION_DEFAULT_VISIBLE_FIELDS,
  );
  assert.equal(
    legacy[0].fieldOrderIdsJson,
    KB_COLLECTION_DEFAULT_VISIBLE_FIELDS,
  );
});
