import assert from "node:assert/strict";
import test from "node:test";
import {
  scopeNotionBundle,
  stripPersonalNotionReferences,
} from "../notion-bundle-scope.mjs";

const crm = "e556f0fffae34b4795a40d4cd306732a";
const guest = "a".repeat(32);
const staff = "b".repeat(32);
const child = "c".repeat(32);
const guide = "d".repeat(32);
const photo = "e".repeat(64);
const personalPhoto = "f".repeat(64);
const image = (hash) => ({
  type: "image",
  props: { url: `bundleasset://${hash}` },
});
const text = (value, bold = false) => ({
  type: "text",
  text: value,
  styles: bold ? { bold: true } : {},
});
const link = (href, name) => ({ type: "link", href, content: [text(name)] });
const paragraph = (...content) => ({ type: "paragraph", content });
const page = (sourceId, parentSourceId, ...content) => ({
  sourceId,
  parentSourceId,
  content,
});

test("personal databases and identified contact cards are excluded with descendants and private media", () => {
  const bundle = {
    pages: [
      page(crm, null),
      page(guest, crm, image(personalPhoto)),
      page(staff, null, paragraph(text("ФИО:", true), text("Private name"))),
      page(child, staff),
      page(
        guide,
        null,
        paragraph(text("Телефон:", true), text("Operational contact")),
        paragraph(text("Гости:", true), text("Private plain name")),
        paragraph(link(`notionpage://${guest}`, "Private link name")),
        image(photo),
      ),
    ],
    assets: [{ sha256: photo }, { sha256: personalPhoto }],
  };
  const scoped = scopeNotionBundle(bundle);
  assert.deepEqual(
    [...scoped.excluded].sort(),
    [crm, guest, staff, child].sort(),
  );
  assert.deepEqual(
    scoped.pages.map((p) => p.sourceId),
    [guide],
  );
  assert.deepEqual(
    scoped.assets.map((a) => a.sha256),
    [photo],
  );
  assert.match(JSON.stringify(scoped.pages), /Operational contact/);
  assert.doesNotMatch(JSON.stringify(scoped.pages), /Private/);
  assert.doesNotMatch(JSON.stringify(scoped.pages), new RegExp(guest));
});

test("legacy local links and external Notion links lose both the private ID and label", () => {
  const venue = "dddddddd-0000-0000-0000-000000000001";
  const data = stripPersonalNotionReferences(
    [
      paragraph(link(`/knowledge/notion-${venue}-${guest}`, "Old guest name")),
      paragraph(link(`https://www.notion.so/card-${staff}`, "Old staff name")),
      paragraph(link(`notionpage://${guide}`, "Guide")),
    ],
    new Set([guest, staff]),
  );
  assert.deepEqual(data[0].content, [text("Личная карточка пропущена")]);
  assert.deepEqual(data[1].content, [text("Личная карточка пропущена")]);
  assert.deepEqual(data[2].content, [link(`notionpage://${guide}`, "Guide")]);
});
