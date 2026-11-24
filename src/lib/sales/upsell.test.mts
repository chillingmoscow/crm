import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countUpsellDay,
  lineKey,
  resolveUpsellLine,
  validateUpsellLines,
  type UpsellCatalog,
  type UpsellLine,
} from "./upsell.ts";
import type { Order, OrderDetail } from "./calculate.ts";

const order = (id: number, extra: Partial<Order> = {}): Order => ({
  id,
  payer_id: null,
  gross: 1000,
  returned: false,
  deleted: false,
  status: "closed",
  ...extra,
});
type L = OrderDetail["lines"][number];
const detail = (id: number, lines: L[], extra: Partial<OrderDetail> = {}): OrderDetail => ({
  id,
  returned: false,
  deleted: false,
  service: 0,
  lines,
  ...extra,
});
const dl = (id: number, amount = 500, quantity = 1, kind: L["kind"] = "dish"): L => ({ product_id: id, amount, quantity, kind });
const rule = (target: UpsellLine["target"], id: string, rate: number): UpsellLine => ({ target, external_id: id, name: `${target} ${id}`, rate });

const catalog: UpsellCatalog = {
  items: new Map([
    ["dish:1", { name: "Кальян", group: "dish_group:10" }],
    ["dish:2", { name: "Дорогой кальян", group: "dish_group:10" }],
    ["dish:3", { name: "Чай", group: "dish_group:11" }],
    ["modifier:7", { name: "Лёд", group: "modifier_group:70" }],
    ["modifier:2022", { name: "Мод", group: null }],
    ["dish:2022", { name: "Блюдо", group: null }],
    ["dish:50", { name: "Только блюдо", group: null }],
    ["modifier:51", { name: "Только мод", group: null }],
  ]),
  groups: new Map([
    ["dish_group:10", { name: "Кальяны", parent: "dish_group:9" }],
    ["dish_group:9", { name: "Всё", parent: null }],
    ["dish_group:11", { name: "Чай", parent: "dish_group:9" }],
    ["modifier_group:70", { name: "Добавки", parent: null }],
  ]),
  // 300 — товар; 2022 есть ещё и у блюда с модификатором (неоднозначный id)
  other: new Set(["300", "2022"]),
};

const noSettings = { tip_products: {}, deposit_products: {}, parking_product_ids: [] as number[] };
const run = (
  details: OrderDetail[],
  lines: UpsellLine[],
  orders?: Order[],
  staffIds: number[] = [],
  cat = catalog,
  settings = noSettings,
) => countUpsellDay({ orders: orders ?? details.map((d) => order(d.id)), details, staffIds, lines, catalog: cat, settings });

test("блюдо со своей ставкой внутри категории со ставкой оплачивается один раз по блюду", () => {
  const r = run([detail(1, [dl(1, 500, 2)])], [rule("dish_group", "10", 50), rule("dish", "1", 100)]);
  assert.equal(r.bonus, 200);
  assert.deepEqual(r.paid, { "dish:1": "dish:1" });
  assert.deepEqual(r.lines, [
    { key: "dish_group:10", quantity: 0, amount: 0 },
    { key: "dish:1", quantity: 2, amount: 200 },
  ]);
});

test("ближайшая категория главнее дальней", () => {
  const lines = [rule("dish_group", "9", 10), rule("dish_group", "10", 50)];
  assert.equal(resolveUpsellLine("dish:1", lines, catalog), "dish_group:10");
  assert.equal(resolveUpsellLine("dish:3", lines, catalog), "dish_group:9");
  assert.equal(resolveUpsellLine("dish:50", lines, catalog), null);
});

test("цикл в дереве групп — ошибка", () => {
  const cyc: UpsellCatalog = {
    items: new Map([["dish:1", { name: "x", group: "dish_group:1" }]]),
    groups: new Map([
      ["dish_group:1", { name: "a", parent: "dish_group:2" }],
      ["dish_group:2", { name: "b", parent: "dish_group:1" }],
    ]),
    other: new Set(),
  };
  assert.throws(() => resolveUpsellLine("dish:1", [rule("dish_group", "99", 1)], cyc));
});

test("Staff, удалённые и возвращённые чеки не считаются", () => {
  const lines = [rule("dish", "1", 100)];
  const orders = [
    order(1),
    order(2, { payer_id: 7 }),
    order(3, { deleted: true }),
    order(4, { returned: true }),
    order(5, { status: "cancelled" }),
    order(6),
  ];
  const details = [
    detail(1, [dl(1)]),
    detail(2, [dl(1)]),
    detail(3, [dl(1)]),
    detail(4, [dl(1)]),
    detail(5, [dl(1)]),
    detail(6, [dl(1)], { deleted: true }),
  ];
  const r = run(details, lines, orders, [7]);
  assert.equal(r.bonus, 100);
  assert.equal(r.lines[0].quantity, 1);
});

test("бесплатная строка (amount 0) не оплачивается, а количество строки суммируется дробным", () => {
  const r = run(
    [detail(1, [dl(1, 90, 0.5), dl(1, 180, 1), dl(1, 0, 3), dl(999, 0, 2)])],
    [rule("dish", "1", 180)],
  );
  assert.equal(r.lines[0].quantity, 1.5);
  assert.equal(r.lines[0].amount, 270);
  assert.equal(r.bonus, 270);
  assert.deepEqual(r.unknown, []);
});

test("модификатор считается своей строкой по своей группе", () => {
  const r = run([detail(1, [dl(7, 30, 2, "modifier")])], [rule("modifier_group", "70", 15)]);
  assert.equal(r.bonus, 30);
  assert.deepEqual(r.paid, { "modifier:7": "modifier_group:70" });
});

test("блюдо и модификатор с одним id не путаются", () => {
  const r = run(
    [detail(1, [dl(2022, 100, 1, "dish"), dl(2022, 100, 1, "modifier")])],
    [rule("modifier", "2022", 40)],
  );
  assert.equal(r.bonus, 40);
  assert.deepEqual(r.paid, { "modifier:2022": "modifier:2022" });
});

test("позиция не из каталога — в unknown, сумма считается по известным", () => {
  const r = run(
    [detail(1, [dl(1, 100, 1), dl(777, 100, 2), dl(777, 50, 1), dl(555, 10, 1, "modifier")])],
    [rule("dish", "1", 100)],
  );
  assert.equal(r.bonus, 100);
  assert.deepEqual(r.unknown, [
    { key: "dish:777", quantity: 3 },
    { key: "modifier:555", quantity: 1 },
  ]);
});

test("позиции вида other не оплачиваются и не в unknown", () => {
  const r = run([detail(1, [dl(1, 100, 1, "other"), dl(777, 100, 1, "other")])], [rule("dish", "1", 100)]);
  assert.equal(r.bonus, 0);
  assert.deepEqual(r.unknown, []);
  assert.deepEqual(r.paid, {});
});

test("строки без продаж есть в результате с нулём", () => {
  const r = run([], [rule("dish", "1", 100), rule("modifier_group", "70", 5)]);
  assert.equal(r.bonus, 0);
  assert.deepEqual(r.lines, [
    { key: "dish:1", quantity: 0, amount: 0 },
    { key: "modifier_group:70", quantity: 0, amount: 0 },
  ]);
  assert.deepEqual(r.paid, {});
  assert.deepEqual(r.unknown, []);
});

test("строка без вида находится по каталогу, если id есть только у блюда или только у модификатора", () => {
  const noKind = (id: number): L => ({ product_id: id, amount: 100, quantity: 1 });
  const r = run([detail(1, [noKind(50), noKind(51)])], [rule("dish", "50", 10), rule("modifier", "51", 20)]);
  assert.equal(r.bonus, 30);
  assert.deepEqual(r.paid, { "dish:50": "dish:50", "modifier:51": "modifier:51" });
});

test("товар без вида строки — не в unknown и не оплачивается", () => {
  const noKind = (id: number): L => ({ product_id: id, amount: 100, quantity: 3 });
  const r = run([detail(1, [noKind(300), noKind(301)])], [rule("dish_group", "9", 10)]);
  assert.equal(r.bonus, 0);
  assert.deepEqual(r.paid, {});
  assert.deepEqual(r.unknown, [{ key: "?:301", quantity: 3 }]);
});

test("id есть и у блюда, и у модификатора — строка в unknown", () => {
  const r = run([detail(1, [{ product_id: 2022, amount: 100, quantity: 2 }])], [rule("dish", "2022", 10)]);
  assert.equal(r.bonus, 0);
  assert.deepEqual(r.unknown, [{ key: "?:2022", quantity: 2 }]);
});

test("итог округляется до рубля", () => {
  const r = run([detail(1, [dl(1, 100, 3)])], [rule("dish", "1", 33.33)]);
  assert.equal(r.bonus, 100);
  assert.equal(r.lines[0].amount, 99.99);
});

test("неполные чеки — ошибка", () => {
  assert.throws(() => countUpsellDay({ orders: [order(1)], details: [], staffIds: [], lines: [], catalog, settings: noSettings }));
});

test("результат проходит проверку фиксации: ключи, числа, свои свойства", () => {
  const r = run([detail(1, [dl(1)])], [rule("dish", "1", 1), rule("dish_group", "11", 2)]);
  assert.deepEqual(Object.keys(r).sort(), ["bonus", "lines", "paid", "unknown"]);
  assert.ok(Number.isInteger(r.bonus));
  assert.deepEqual(r.lines.map((l) => l.key), ["dish:1", "dish_group:11"].map((k) => k));
  assert.equal(lineKey({ target: "dish", external_id: "1" }), "dish:1");
});

test("validateUpsellLines принимает верные строки", () => {
  assert.doesNotThrow(() => validateUpsellLines([rule("dish", "1", 1.5), rule("dish_group", "1", 0)]));
});

test("validateUpsellLines: повтор цели, ставка 1.005, ingredient — ошибки", () => {
  assert.throws(() => validateUpsellLines([rule("dish", "1", 1), rule("dish", "1", 2)]), /повторяется/);
  assert.throws(() => validateUpsellLines([rule("dish", "1", 1.005)]), /ставка/);
  assert.throws(() => validateUpsellLines([{ target: "ingredient" as never, external_id: "1", name: "x", rate: 1 }]));
  assert.throws(() => validateUpsellLines([rule("dish", "abc", 1)]), /код/);
  assert.throws(() => validateUpsellLines([{ ...rule("dish", "1", 1), name: "   " }]), /Название/);
  assert.throws(() => validateUpsellLines([rule("dish", "1", -1)]), /ставка/);
  assert.throws(() => validateUpsellLines([rule("dish", "1", 1000001)]), /ставка/);
  assert.throws(() => validateUpsellLines([rule("dish", "1", Number.NaN)]), /ставка/);
  assert.throws(
    () => validateUpsellLines(Array.from({ length: 501 }, (_, i) => rule("dish", String(i), 1))),
    /500/,
  );
});

test("позиция в категории, которой нет в каталоге, — в unknown, а не молча без оплаты", () => {
  const cat: UpsellCatalog = {
    items: new Map([
      ["dish:1", { name: "x", group: "dish_group:10" }],
      ["dish:2", { name: "y", group: "dish_group:9" }],
    ]),
    groups: new Map([["dish_group:9", { name: "Всё", parent: null }]]),
    other: new Set(),
  };
  const r = run([detail(1, [dl(1, 100, 2), dl(2, 100, 1)])], [rule("dish_group", "9", 10)], undefined, [], cat);
  assert.deepEqual(r.unknown, [{ key: "dish:1", quantity: 2 }]);
  assert.deepEqual(r.paid, { "dish:2": "dish_group:9" });
  assert.equal(r.bonus, 10);
  const own = run([detail(1, [dl(1, 100, 1)])], [rule("dish", "1", 5)], undefined, [], cat);
  assert.deepEqual(own.unknown, []);
  assert.equal(own.bonus, 5);
});

test("ставка проверяется по записи: 1.0000000001 отклоняется", () => {
  assert.throws(() => validateUpsellLines([rule("dish", "1", 1.0000000001)]), /ставка/);
  assert.doesNotThrow(() => validateUpsellLines([rule("dish", "1", 1000000)]));
});

test("countUpsellDay проверяет строки правил", () => {
  assert.throws(() => run([], [rule("dish", "1", 1), rule("dish", "1", 2)]), /повторяется/);
});

test("чаевые, депозит и парковка внутри оплачиваемой категории не оплачиваются и не в unknown", () => {
  const cat: UpsellCatalog = {
    items: new Map([
      ["dish:1", { name: "a", group: "dish_group:9" }],
      ["dish:90", { name: "tip", group: "dish_group:9" }],
      ["dish:91", { name: "dep", group: "dish_group:9" }],
      ["dish:92", { name: "park", group: "dish_group:9" }],
    ]),
    groups: new Map([["dish_group:9", { name: "Всё", parent: null }]]),
    other: new Set(),
  };
  const settings = { tip_products: { "90": 1 }, deposit_products: { "91": 1 }, parking_product_ids: [92] };
  const r = run(
    [detail(1, [dl(1), dl(90), dl(91), dl(92), dl(93)])],
    [rule("dish_group", "9", 10)],
    undefined,
    [],
    cat,
    settings,
  );
  assert.equal(r.bonus, 10);
  assert.deepEqual(r.paid, { "dish:1": "dish_group:9" });
  assert.deepEqual(r.unknown, [{ key: "dish:93", quantity: 1 }]);
});

test("строки с нулевым или отрицательным количеством не оплачиваются и не в unknown", () => {
  const r = run([detail(1, [dl(1, 100, 1), dl(1, 100, -5), dl(1, 100, 0), dl(777, 100, -1)])], [rule("dish", "1", 10)]);
  assert.equal(r.bonus, 10);
  assert.deepEqual(r.unknown, []);
});
