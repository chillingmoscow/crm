import { test } from "node:test";
import assert from "node:assert/strict";

import {
  countVisibleCategories,
  flattenCategories,
  type CategoryView,
  type TreeCategory,
  type TreeGroup,
} from "./category-tree.ts";

const group = (id: string, name: string, extra: Partial<TreeGroup> = {}): TreeGroup => ({
  id,
  name,
  type: null,
  isPayroll: false,
  ...extra,
});

const category = (
  id: string,
  name: string,
  type: "income" | "expense",
  groupId: string | null = null,
  extra: Partial<TreeCategory> = {},
): TreeCategory => ({
  id,
  name,
  type,
  groupId,
  description: null,
  color: null,
  isSystem: false,
  isPayroll: false,
  archived: false,
  archivedAt: null,
  archiveBlocked: null,
  operations: null,
  lastDate: null,
  total: null,
  ...extra,
});

const view = (extra: Partial<CategoryView> = {}): CategoryView => ({
  collapsed: new Set(),
  search: "",
  archived: false,
  type: "",
  group: "",
  sorting: [],
  ...extra,
});

const ids = (rows: ReturnType<typeof flattenCategories>) => rows.map((row) => row.id);

const groups = [group("fot", "Фонд оплаты труда", { isPayroll: true }), group("rent", "Аренда и связь")];
const categories = [
  category("waiter", "Официант", "expense", "fot"),
  category("cook", "Повар", "expense", "fot"),
  category("office", "Офис", "expense", "rent"),
  category("pos", "Выручка POS", "income"),
  category("food", "Закупка продуктов", "expense"),
  category("old", "Старая статья", "expense", null, { archived: true }),
];

test("группы по названию первыми, затем статьи без группы: доходы, потом расходы", () => {
  assert.deepEqual(ids(flattenCategories(groups, categories, view())), [
    "group:rent",
    "office",
    "group:fot",
    "waiter",
    "cook",
    "pos",
    "food",
  ]);
});

test("сортировка по названию работает внутри групп и не перемешивает их", () => {
  const rows = flattenCategories(groups, categories, view({ sorting: [{ id: "name", desc: true }] }));
  assert.deepEqual(ids(rows), ["group:fot", "cook", "waiter", "group:rent", "office", "food", "pos"]);
});

test("свёрнутая группа остаётся строкой с числом статей", () => {
  const rows = flattenCategories(groups, categories, view({ collapsed: new Set(["fot"]) }));
  const fot = rows.find((row) => row.id === "group:fot");
  assert.ok(fot && fot.type === "group");
  assert.equal(fot.expanded, false);
  assert.equal(fot.count, 2);
  assert.ok(!ids(rows).includes("waiter"));
});

test("поиск раскрывает свёрнутые группы и оставляет только совпадения", () => {
  const rows = flattenCategories(
    groups,
    categories,
    view({ search: "повар", collapsed: new Set(["fot"]) }),
  );
  assert.deepEqual(ids(rows), ["group:fot", "cook"]);
});

test("группа, совпавшая по названию, показывается со всеми статьями", () => {
  const rows = flattenCategories(groups, categories, view({ search: "оплаты" }));
  assert.deepEqual(ids(rows), ["group:fot", "waiter", "cook"]);
});

test("фильтр по типу убирает пустые группы", () => {
  const rows = flattenCategories(groups, categories, view({ type: "income" }));
  assert.deepEqual(ids(rows), ["pos"]);
});

test("фильтр «Без группы» и по конкретной группе", () => {
  assert.deepEqual(ids(flattenCategories(groups, categories, view({ group: "none" }))), [
    "pos",
    "food",
  ]);
  assert.deepEqual(ids(flattenCategories(groups, categories, view({ group: "rent" }))), [
    "group:rent",
    "office",
  ]);
});

test("архив показывает только архивные статьи", () => {
  assert.deepEqual(ids(flattenCategories(groups, categories, view({ archived: true }))), ["old"]);
});

test("ссылка на несуществующую группу — статья без группы", () => {
  const rows = flattenCategories(groups, [category("lost", "Потерянная", "expense", "gone")], view());
  assert.deepEqual(ids(rows), ["lost"]);
});

test("пустые значения при сортировке по числу — в конце в обе стороны", () => {
  const list = [
    category("a", "А", "expense", null, { operations: 5 }),
    category("b", "Б", "expense", null, { operations: null }),
    category("c", "В", "expense", null, { operations: 12 }),
  ];
  assert.deepEqual(ids(flattenCategories([], list, view({ sorting: [{ id: "operations", desc: true }] }))), [
    "c",
    "a",
    "b",
  ]);
  assert.deepEqual(ids(flattenCategories([], list, view({ sorting: [{ id: "operations", desc: false }] }))), [
    "a",
    "c",
    "b",
  ]);
});

test("счётчик «N из M» не зависит от свёрнутых групп", () => {
  assert.equal(countVisibleCategories(groups, categories, view({ collapsed: new Set(["fot"]) })), 5);
  assert.equal(countVisibleCategories(groups, categories, view({ search: "о" })), 4);
});
