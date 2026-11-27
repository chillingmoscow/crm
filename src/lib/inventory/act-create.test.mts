import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGroupTree,
  buildInventoryItemSample,
  collectGroupSubtree,
  countSelectedItems,
  defaultActComment,
  pendingActItems,
  planActItems,
  quickRestoProductKey,
  validateCreateActInput,
  type CreateActGroup,
  type CreateActProduct,
} from "./act-create.ts";

const SINGLE = "ru.edgex.quickresto.modules.warehouse.nomenclature.singleproduct.SingleProduct";
const DISH = "ru.edgex.quickresto.modules.warehouse.nomenclature.dish.Dish";
const UNIT = "ru.edgex.quickresto.modules.core.dictionaries.measureunits.MeasureUnit";

const groups: CreateActGroup[] = [
  { id: "tea", parentId: null, name: "Чай кофе пюре сиропы", kind: "ingredient" },
  { id: "coffee", parentId: "tea", name: "Кофе", kind: "ingredient" },
  { id: "syrup", parentId: "tea", name: "Сиропы", kind: "ingredient" },
  { id: "empty", parentId: null, name: "Не используем", kind: "ingredient" },
  { id: "hookah", parentId: null, name: "Кальяны", kind: "dish" },
];

function product(over: Partial<CreateActProduct> & { id: string; groupId: string }): CreateActProduct {
  const name = over.name ?? over.id;
  return {
    kind: "ingredient",
    externalId: over.id.replace(/\D/g, "") || "1",
    name,
    rawPayload: {
      id: Number(over.id.replace(/\D/g, "") || "1"),
      className: SINGLE,
      name,
      measureUnit: { id: 2, className: UNIT },
    },
    ...over,
  };
}

const products: CreateActProduct[] = [
  product({ id: "p1393", groupId: "coffee", name: "Кофе зерновой / Beato" }),
  product({ id: "p55", groupId: "syrup", name: "Сироп / Ваниль" }),
  {
    id: "d519",
    groupId: "hookah",
    kind: "dish",
    externalId: "519",
    name: "Кальян / Классика",
    rawPayload: { id: 519, className: DISH, name: "Кальян / Классика", measureUnit: { id: 4, className: UNIT } },
  },
];

test("группа включает подгруппы, как кнопка «Добавить группы» в Quick Resto", () => {
  assert.deepEqual([...collectGroupSubtree(groups, ["tea"])].sort(), ["coffee", "syrup", "tea"]);
  assert.deepEqual([...collectGroupSubtree(groups, ["coffee"])], ["coffee"]);
});

test("неизвестные id и цикл в данных не ломают обход", () => {
  const looped: CreateActGroup[] = [
    { id: "a", parentId: "b", name: "A", kind: "ingredient" },
    { id: "b", parentId: "a", name: "B", kind: "ingredient" },
  ];
  assert.deepEqual([...collectGroupSubtree(looped, ["a", "zzz"])].sort(), ["a", "b"]);
});

test("тело позиции — ссылка на товар и единицу, как проверено на проде", () => {
  assert.deepEqual(buildInventoryItemSample(products[0]), {
    className: "ru.edgex.quickresto.modules.warehouse.inventory.items.InventoryItem",
    product: { id: 1393, className: SINGLE, title: "Кофе зерновой / Beato" },
    measureUnit: { id: 2, className: UNIT },
  });
});

test("без данных Quick Resto позицию не собрать", () => {
  assert.equal(buildInventoryItemSample(product({ id: "p1", groupId: "coffee", rawPayload: null })), null);
  assert.equal(
    buildInventoryItemSample(product({ id: "p1", groupId: "coffee", rawPayload: { id: 1, className: SINGLE } })),
    null,
  );
});

test("план акта: подгруппы, без повторов, по алфавиту, блюда со своими группами", () => {
  const plan = planActItems({ groups, products, selectedGroupIds: ["tea", "coffee", "hookah"] });
  assert.deepEqual(
    plan.items.map((item) => item.name),
    ["Кальян / Классика", "Кофе зерновой / Beato", "Сироп / Ваниль"],
  );
  assert.deepEqual(plan.skipped, []);
});

test("позиция чужого вида в группе не попадает в акт", () => {
  const plan = planActItems({
    groups,
    products: [{ ...products[2], groupId: "coffee" }],
    selectedGroupIds: ["coffee"],
  });
  assert.equal(plan.items.length, 0);
});

test("позиции без данных Quick Resto перечисляются, а не теряются молча", () => {
  const plan = planActItems({
    groups,
    products: [...products, product({ id: "p7", groupId: "coffee", name: "Без единицы", rawPayload: { id: 7 } })],
    selectedGroupIds: ["coffee"],
  });
  assert.deepEqual(plan.items.map((item) => item.name), ["Кофе зерновой / Beato"]);
  assert.deepEqual(plan.skipped, ["Без единицы"]);
});

test("повтор после сбоя добавляет только недостающие позиции", () => {
  const plan = planActItems({ groups, products, selectedGroupIds: ["tea"] });
  const existing = new Set([quickRestoProductKey(SINGLE, 1393) as string]);
  assert.deepEqual(pendingActItems(plan.items, existing).map((item) => item.name), ["Сироп / Ваниль"]);
});

test("ключ позиции учитывает класс: блюдо и ингредиент с одним id — разные", () => {
  assert.notEqual(quickRestoProductKey(SINGLE, 5), quickRestoProductKey(DISH, 5));
  assert.equal(quickRestoProductKey(SINGLE, 5), quickRestoProductKey(SINGLE, "5"));
  assert.equal(quickRestoProductKey(SINGLE, null), null);
});

test("дерево для панели: порядок обхода, глубина, итоги с подгруппами, без пустых веток", () => {
  const counts = new Map([
    ["coffee", 1],
    ["syrup", 3],
    ["hookah", 2],
  ]);
  const tree = buildGroupTree({ groups, productCountByGroup: counts });
  assert.deepEqual(
    tree.map((node) => [node.name, node.depth, node.itemCount]),
    [
      ["Кальяны", 0, 2],
      ["Чай кофе пюре сиропы", 0, 4],
      ["Кофе", 1, 1],
      ["Сиропы", 1, 3],
    ],
  );
  assert.equal(countSelectedItems({ groups, productCountByGroup: counts, selectedGroupIds: ["tea", "coffee"] }), 4);
});

test("комментарий по умолчанию — названия групп", () => {
  assert.equal(defaultActComment(["Пиво и сидр", " Крепкий алкоголь "]), "Пиво и сидр / Крепкий алкоголь");
  assert.equal(defaultActComment([]), "");
  assert.equal(defaultActComment(["а".repeat(300)]).length, 200);
});

const valid = {
  attemptId: "11111111-1111-4111-8111-111111111111",
  storeId: "22222222-2222-4222-8222-222222222222",
  date: "2026-11-27",
  groupIds: ["33333333-3333-4333-8333-333333333333"],
  comment: "Еда",
  assignedTo: "44444444-4444-4444-8444-444444444444",
  reviewerId: null,
};

test("проверка формы", () => {
  assert.equal(validateCreateActInput(valid), null);
  assert.equal(validateCreateActInput({ ...valid, groupIds: [] }), "Выберите хотя бы одну группу.");
  assert.equal(validateCreateActInput({ ...valid, date: "27.11.2026" }), "Укажите дату акта.");
  assert.equal(validateCreateActInput({ ...valid, storeId: "" }), "Выберите склад.");
  assert.match(
    validateCreateActInput({ ...valid, reviewerId: valid.assignedTo }) ?? "",
    /разными людьми/,
  );
  assert.match(validateCreateActInput({ ...valid, comment: "x".repeat(201) }) ?? "", /Комментарий/);
});
