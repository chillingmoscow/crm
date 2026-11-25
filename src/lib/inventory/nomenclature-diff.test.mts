import assert from "node:assert/strict";
import test from "node:test";

import {
  MASS_ARCHIVE_MIN_ITEMS,
  planArchive,
  sameFields,
  splitByChange,
  stableStringify,
  type LocalCatalogRow,
} from "./nomenclature-diff.ts";

const live = (count: number, prefix = "p"): LocalCatalogRow[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-local-${index}`,
    external_id: `${prefix}${index}`,
    archived_at: null,
  }));

const ids = (rows: LocalCatalogRow[]) => new Set(rows.map((row) => row.external_id as string));

test("пустой ответ Quick Resto не архивирует живые позиции", () => {
  const plan = planArchive({ incomingExternalIds: new Set(), local: live(40) });
  assert.equal(plan.guarded, true);
  assert.deepEqual(plan.toArchive, []);
  assert.equal(plan.guardedCount, 40);
});

test("пустой ответ при маленьком справочнике тоже защищён", () => {
  const plan = planArchive({ incomingExternalIds: new Set(), local: live(2) });
  assert.equal(plan.guarded, true);
  assert.deepEqual(plan.toArchive, []);
});

test("пропажа больше половины живых позиций — сбой выгрузки, архивации нет", () => {
  const local = live(100);
  const incoming = ids(local.slice(0, 40));
  const plan = planArchive({ incomingExternalIds: incoming, local });
  assert.equal(plan.guarded, true);
  assert.deepEqual(plan.toArchive, []);
  assert.equal(plan.guardedCount, 60);
});

test("новые позиции в ответе не маскируют пропажу старых", () => {
  const local = live(100);
  const incoming = new Set([...ids(local.slice(0, 40)), ...Array.from({ length: 80 }, (_, i) => `new${i}`)]);
  const plan = planArchive({ incomingExternalIds: incoming, local });
  assert.equal(plan.guarded, true);
});

test("обычная чистка меню архивируется", () => {
  const local = live(100);
  const incoming = ids(local.slice(0, 90));
  const plan = planArchive({ incomingExternalIds: incoming, local });
  assert.equal(plan.guarded, false);
  assert.equal(plan.toArchive.length, 10);
  assert.ok(plan.toArchive.includes("p-local-95"));
});

test("ровно половина — ещё не массовая архивация", () => {
  const local = live(20);
  const plan = planArchive({ incomingExternalIds: ids(local.slice(0, 10)), local });
  assert.equal(plan.guarded, false);
  assert.equal(plan.toArchive.length, 10);
});

test("в маленьком справочнике удаление пары позиций проходит", () => {
  const local = live(3);
  const plan = planArchive({ incomingExternalIds: ids(local.slice(0, 1)), local });
  assert.ok(MASS_ARCHIVE_MIN_ITEMS > 2);
  assert.equal(plan.guarded, false);
  assert.equal(plan.toArchive.length, 2);
});

test("возврат из архива работает и под защитой", () => {
  const local: LocalCatalogRow[] = [
    ...live(10),
    { id: "back-local", external_id: "back", archived_at: "2026-11-01T00:00:00Z" },
    { id: "gone-local", external_id: "gone", archived_at: "2026-11-01T00:00:00Z" },
  ];
  const plan = planArchive({ incomingExternalIds: new Set(["back"]), local });
  assert.equal(plan.guarded, true);
  assert.deepEqual(plan.toArchive, []);
  assert.deepEqual(plan.toUnarchive, ["back-local"]);
});

test("уже архивные позиции не считаются живыми", () => {
  const local: LocalCatalogRow[] = [
    ...live(10),
    ...Array.from({ length: 30 }, (_, i) => ({ id: `old-${i}`, external_id: `old${i}`, archived_at: "2026-01-01T00:00:00Z" })),
  ];
  const plan = planArchive({ incomingExternalIds: ids(local.slice(0, 10)), local });
  assert.equal(plan.guarded, false);
  assert.deepEqual(plan.toArchive, []);
  assert.deepEqual(plan.toUnarchive, []);
});

test("порядок ключей jsonb не делает позицию изменённой", () => {
  assert.equal(
    stableStringify({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }),
    stableStringify({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }),
  );
  assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
});

const KEYS = ["name", "ratio", "tags", "raw_payload"] as const;

test("неизменённая позиция не попадает в запись", () => {
  const existing = new Map<string, Record<string, unknown>>([
    ["1", { external_id: "1", name: "Лимон", ratio: 1, tags: [], raw_payload: { version: 3, name: "Лимон", id: 1 } }],
    ["2", { external_id: "2", name: "Лайм", ratio: null, tags: ["a"], raw_payload: { id: 2 } }],
  ]);
  const incoming = [
    { external_id: "1", name: "Лимон", ratio: 1, tags: [], raw_payload: { id: 1, name: "Лимон", version: 3 } },
    { external_id: "2", name: "Лайм", ratio: null, tags: ["a"], raw_payload: { id: 2 } },
  ];
  const split = splitByChange(incoming, existing, KEYS);
  assert.equal(split.unchanged.length, 2);
  assert.equal(split.changed.length, 0);
  assert.equal(split.inserted.length, 0);
});

test("изменённая и новая позиции попадают в запись", () => {
  const existing = new Map<string, Record<string, unknown>>([
    ["1", { external_id: "1", name: "Лимон", ratio: 1, tags: [], raw_payload: { id: 1, price: 10 } }],
  ]);
  const incoming = [
    { external_id: "1", name: "Лимон", ratio: 1, tags: [], raw_payload: { id: 1, price: 12 } },
    { external_id: "3", name: "Мята", ratio: 1, tags: [], raw_payload: { id: 3 } },
  ];
  const split = splitByChange(incoming, existing, KEYS);
  assert.deepEqual(split.changed.map((row) => row.external_id), ["1"]);
  assert.deepEqual(split.inserted.map((row) => row.external_id), ["3"]);
  assert.equal(split.unchanged.length, 0);
});

test("отсутствующее поле равно null, а не изменению", () => {
  assert.equal(sameFields({ name: "А" }, { name: "А", ratio: null }, ["name", "ratio"]), true);
  assert.equal(sameFields({ name: "А", ratio: 0 }, { name: "А", ratio: null }, ["name", "ratio"]), false);
});
