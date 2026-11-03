import { test } from "node:test";
import assert from "node:assert/strict";
import { groupMissing } from "./deduction-missing.ts";

const lookup = {
  documents: new Map([["d1", { number: "ИНВ-15", date: "2026-10-31" }]]),
  employees: new Map([["e1", "Иванов Иван"]]),
};

test("недостающее называется словами, с ссылкой на акт, а не техническим ID", () => {
  const groups = groupMissing(
    ["inventory:d1", "writeoff:v1:77", "shift:e1:2026-10-05", "inventory:d9"],
    lookup,
  );
  const byKind = Object.fromEntries(groups.map((g) => [g.kind, g]));
  assert.equal(byKind.inventory.items[0].label, "Акт ИНВ-15 от 31.10.2026");
  assert.equal(byKind.inventory.items[0].href, "/documents/inventory/d1");
  // Акта нет в справочнике - его ID не теряется.
  assert.equal(byKind.inventory.items[1].label, "Акт d9");
  assert.equal(byKind.writeoff.items[0].label, "Акт списания 77");
  assert.equal(byKind.shift.items[0].label, "Иванов Иван, 05.10.2026");
});

test("расхождение часовых поясов читается без технической записи", () => {
  const groups = groupMissing(["timezone:venue=Europe/Moscow;writeoffs=Asia/Yekaterinburg"], lookup);
  assert.equal(groups[0].kind, "timezone");
  assert.match(groups[0].items[0].label, /заведение Europe\/Moscow/);
  assert.match(groups[0].items[0].label, /списания Asia\/Yekaterinburg/);
});

test("неизвестная запись не пропадает", () => {
  const groups = groupMissing(["что-то:новое"], lookup);
  assert.equal(groups[0].kind, "other");
  assert.equal(groups[0].items[0].label, "что-то:новое");
});

test("пустой список - пустой результат", () => {
  assert.deepEqual(groupMissing([], lookup), []);
});
