import test from "node:test";
import assert from "node:assert/strict";
import { mergeImportedContent } from "../notion-bundle-content.mjs";

test("manual text survives successive source updates, while nested media is copied once", () => {
  const manual = [{ type: "paragraph", content: "Вручную уточнённая инструкция" }];
  const image = { type: "image", props: { url: "kbfile://account/photo.png" } };
  const incoming = [{ type: "bulletListItem", content: "Исходная инструкция", children: [image] }];
  const first = mergeImportedContent({ current: manual, incoming, previousHash: "original", currentHash: "edited" });
  assert.deepEqual(first, { content: [...manual, image], manuallyEdited: true });
  const second = mergeImportedContent({ current: first.content, incoming: [...incoming, { type: "paragraph", content: "Новое описание источника" }], currentHash: "enriched" });
  assert.deepEqual(second, first);
});

test("unchanged imported text can be refreshed completely", () => {
  const incoming = [{ type: "paragraph", content: "Обновлённая исходная инструкция" }];
  assert.deepEqual(mergeImportedContent({ current: [{ type: "paragraph", content: "Старое" }], incoming, previousHash: "same", currentHash: "same" }), { content: incoming, manuallyEdited: false });
});


test("a removed imported image stays removed while genuinely new evidence is added", () => {
  const removed = { type: "image", props: { url: "kbfile://account/removed.png" } };
  const added = { type: "image", props: { url: "kbfile://account/new.png" } };
  const manual = [{ type: "paragraph", content: "Редакция без прежней фотографии" }];
  const result = mergeImportedContent({ current: manual, incoming: [removed, added], currentHash: "edited", previousHash: "original", seenMedia: [removed.props.url] });
  assert.deepEqual(result, { content: [...manual, added], manuallyEdited: true });
});
