import { test } from "node:test";
import assert from "node:assert/strict";

import {
  KB_COLLECTION_VIEW_LABELS,
  getPageCollectionId,
  kbCollectionSlashProps,
} from "./collection.ts";

test("slash collection starts with a list view named «Список»", () => {
  const props = kbCollectionSlashProps("p1");
  assert.equal(props.view, "list");
  assert.equal(props.viewTitle, KB_COLLECTION_VIEW_LABELS.list);
  assert.equal(props.viewTitle, "Список");
  assert.equal(props.title, "Коллекция");
  assert.equal(props.collectionId, getPageCollectionId("p1"));
  assert.equal(props.viewId, "");
});

test("slash collection without a page gets its own id", () => {
  const props = kbCollectionSlashProps(null);
  assert.ok(props.collectionId.startsWith("collection_"));
});
