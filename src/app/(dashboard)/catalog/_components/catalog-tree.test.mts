import { test } from "node:test";
import assert from "node:assert/strict";

import {
  countProducts,
  flattenCatalog,
  indexCatalog,
  type CatalogGroup,
  type CatalogProduct,
  type CatalogView,
} from "./catalog-tree.ts";

const group = (id: string, name: string, parentGroupId: string | null = null): CatalogGroup => ({
  id,
  externalId: `ext-${id}`,
  name,
  parentGroupId,
  imageUrl: null,
  previewUrl: null,
});

const product = (
  id: string,
  name: string,
  groupId: string | null,
  extra: Partial<CatalogProduct> = {},
): CatalogProduct => ({
  id,
  externalId: `ext-${id}`,
  name,
  article: null,
  barcode: null,
  measureUnitName: "кг",
  currentPrimeCost: null,
  storeQuantity: null,
  groupId,
  imageUrl: null,
  previewUrl: null,
  archived: false,
  ...extra,
});

const view = (patch: Partial<CatalogView> = {}): CatalogView => ({
  expanded: new Set(),
  search: "",
  archived: false,
  photo: "",
  sorting: [],
  ...patch,
});

const groups = [
  group("bar", "Бар"),
  group("syrups", "Сиропы", "bar"),
  group("kitchen", "Кухня"),
  group("empty", "Пустая"),
];
const products = [
  product("cola", "Кола", "bar", { currentPrimeCost: 50 }),
  product("lime", "Лайм", "bar", { currentPrimeCost: 10, imageUrl: "x" }),
  product("vanilla", "Ваниль", "syrups", { currentPrimeCost: 30 }),
  product("beef", "Говядина", "kitchen", { archived: true }),
  product("salt", "Соль", null),
];
const index = indexCatalog(groups, products);
const names = (rows: ReturnType<typeof flattenCatalog>) =>
  rows.map((row) => (row.type === "group" ? `[${row.group.name}]` : row.product.name));

test("свёрнутое дерево: только корневые категории с позициями и позиции без категории", () => {
  // «Кухня» — только архивная позиция, «Пустая» без позиций: обеих не видно.
  assert.deepEqual(names(flattenCatalog(index, view())), ["[Бар]", "Соль"]);
});

test("счётчик категории включает вложенные", () => {
  const [bar] = flattenCatalog(index, view());
  assert.equal(bar.type === "group" && bar.productCount, 3);
});

test("раскрытая категория: сначала вложенные категории, потом позиции по названию", () => {
  assert.deepEqual(names(flattenCatalog(index, view({ expanded: new Set(["bar"]) }))), [
    "[Бар]",
    "[Сиропы]",
    "Кола",
    "Лайм",
    "Соль",
  ]);
});

test("поиск раскрывает ветки и оставляет только совпадения", () => {
  assert.deepEqual(names(flattenCatalog(index, view({ search: "ван" }))), [
    "[Бар]",
    "[Сиропы]",
    "Ваниль",
  ]);
});

test("совпадение по названию категории показывает всё её содержимое", () => {
  assert.deepEqual(names(flattenCatalog(index, view({ search: "сироп" }))), [
    "[Бар]",
    "[Сиропы]",
    "Ваниль",
  ]);
});

test("архив показывает только архивные позиции и их ветки", () => {
  assert.deepEqual(names(flattenCatalog(index, view({ archived: true }))), ["[Кухня]", "Говядина"]);
});

test("фильтр по фото", () => {
  assert.deepEqual(names(flattenCatalog(index, view({ photo: "with" }))), ["[Бар]", "Лайм"]);
});

test("сортировка по себестоимости — внутри категории, пустые в конце", () => {
  const rows = flattenCatalog(
    index,
    view({ expanded: new Set(["bar"]), sorting: [{ id: "cost", desc: true }] }),
  );
  assert.deepEqual(names(rows), ["[Бар]", "[Сиропы]", "Кола", "Лайм", "Соль"]);
  const asc = flattenCatalog(
    index,
    view({ expanded: new Set(["bar"]), sorting: [{ id: "cost", desc: false }] }),
  );
  assert.deepEqual(names(asc), ["[Бар]", "[Сиропы]", "Лайм", "Кола", "Соль"]);
});

test("сортировка по названию в обратную сторону переворачивает и категории", () => {
  const rows = flattenCatalog(
    index,
    view({ expanded: new Set(["bar"]), sorting: [{ id: "name", desc: true }] }),
  );
  assert.deepEqual(names(rows), ["[Бар]", "[Сиропы]", "Лайм", "Кола", "Соль"]);
});

test("countProducts считает по архиву и фото, без поиска", () => {
  assert.equal(countProducts(products, { archived: false, photo: "" }), 4);
  assert.equal(countProducts(products, { archived: true, photo: "" }), 1);
  assert.equal(countProducts(products, { archived: false, photo: "without" }), 3);
});

test("категория-сирота (родитель не пришёл) становится корневой", () => {
  const orphanIndex = indexCatalog([group("o", "Сирота", "missing")], [product("p", "Позиция", "o")]);
  assert.deepEqual(names(flattenCatalog(orphanIndex, view())), ["[Сирота]"]);
});
