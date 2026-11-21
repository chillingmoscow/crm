import assert from "node:assert/strict";
import test from "node:test";

import {
  deletedGroupNames,
  groupDraftsDirty,
  isEmptyGroupPlan,
  normalizeGroupName,
  planGroupChanges,
  validateGroupDrafts,
  type SavedGroup,
} from "./bank-account-groups.ts";

const saved: SavedGroup[] = [
  { id: "a", name: "Банк", sort_order: 1 },
  { id: "b", name: "Наличные", sort_order: 2 },
  { id: "c", name: "Резервы", sort_order: 3 },
];

test("normalizeGroupName: края и двойные пробелы", () => {
  assert.equal(normalizeGroupName("  Банк   ВТБ "), "Банк ВТБ");
});

test("validateGroupDrafts: пустое, длинное, повтор без учёта регистра", () => {
  const errors = validateGroupDrafts([
    { id: null, name: "  " },
    { id: null, name: "х".repeat(61) },
    { id: "a", name: "Банк" },
    { id: null, name: " банк " },
  ]);
  assert.deepEqual(Object.keys(errors).map(Number), [0, 1, 3]);
  assert.equal(errors[3], "Такая группа уже есть");
});

test("planGroupChanges: без правок — пустой план", () => {
  const plan = planGroupChanges(saved, saved.map((g) => ({ id: g.id, name: g.name })));
  assert.ok(isEmptyGroupPlan(plan));
  assert.equal(plan.reordered, false);
  assert.equal(groupDraftsDirty(saved, saved.map((g) => ({ id: g.id, name: g.name }))), false);
});

test("planGroupChanges: переименование, новая группа, удаление", () => {
  const plan = planGroupChanges(saved, [
    { id: "a", name: "Банки" },
    { id: "b", name: "Наличные" },
    { id: null, name: " Карты " },
  ]);
  assert.deepEqual(plan.update, [{ id: "a", name: "Банки" }]);
  assert.deepEqual(plan.create, [{ name: "Карты", sort_order: 3 }]);
  assert.deepEqual(plan.remove.map((g) => g.id), ["c"]);
  assert.deepEqual(plan.renamed, [{ id: "a", from: "Банк", to: "Банки" }]);
  assert.equal(plan.reordered, false);
});

test("planGroupChanges: перестановка меняет только сдвинутые номера", () => {
  const plan = planGroupChanges(saved, [
    { id: "b", name: "Наличные" },
    { id: "a", name: "Банк" },
    { id: "c", name: "Резервы" },
  ]);
  assert.deepEqual(plan.update, [
    { id: "b", sort_order: 1 },
    { id: "a", sort_order: 2 },
  ]);
  assert.equal(plan.reordered, true);
});

test("planGroupChanges: удаление из середины — не перестановка", () => {
  const plan = planGroupChanges(saved, [
    { id: "a", name: "Банк" },
    { id: "c", name: "Резервы" },
  ]);
  assert.equal(plan.reordered, false);
  assert.deepEqual(plan.update, [{ id: "c", sort_order: 2 }]);
});

test("planGroupChanges: незнакомый id — группа удалена в другой вкладке", () => {
  assert.throws(() => planGroupChanges(saved, [{ id: "zzz", name: "Х" }]), /STALE_GROUP/);
});

test("planGroupChanges: старые группы с одинаковым sort_order по умолчанию", () => {
  const legacy: SavedGroup[] = [
    { id: "x", name: "Б", sort_order: 0 },
    { id: "y", name: "А", sort_order: 0 },
  ];
  // Панель показывает их по названию: А, Б. Сохранение без правок
  // проставляет номера, но не считается перестановкой.
  const drafts = [
    { id: "y", name: "А" },
    { id: "x", name: "Б" },
  ];
  assert.equal(groupDraftsDirty(legacy, drafts), false);
  const plan = planGroupChanges(legacy, drafts);
  assert.equal(plan.reordered, false);
});

test("deletedGroupNames: id → название из записей журнала, свежая запись важнее", () => {
  const names = deletedGroupNames([
    { deleted: [{ id: "a", name: "Банк (новое)" }] },
    { deleted: [{ id: "a", name: "Банк" }, { id: "b", name: "Наличные" }], created: [] },
    null,
    { deleted: ["старый формат"] },
  ]);
  assert.deepEqual([...names], [
    ["a", "Банк (новое)"],
    ["b", "Наличные"],
  ]);
});
