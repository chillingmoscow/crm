import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUpsellPicker, prefillUpsell, type UpsellPickerItem } from "./upsell-prefill.ts";
import { defaultAdditionalRules, type AdditionalRules } from "./additional.ts";

const item = (
  target: UpsellPickerItem["target"],
  external_id: string,
  name: string,
  extra: Partial<UpsellPickerItem> = {},
): UpsellPickerItem => ({
  key: `${target}:${external_id}`,
  target,
  external_id,
  name,
  path: "",
  parent: null,
  tagged: false,
  archived: false,
  ...extra,
});

const rules = (bar: AdditionalRules["bar"]): AdditionalRules => ({
  ...defaultAdditionalRules,
  bar,
});

test("бар: категория с тем же именем → категория блюд со ставкой группы", () => {
  const picker = [item("dish_group", "10", "Виски"), item("dish", "11", "Виски")];
  const r = prefillUpsell({
    legacyKind: "bar",
    oldRules: rules([{ id: "alcohol", label: "Крепкий алкоголь", branches: ["Виски"], rate: 100 }]),
    picker,
  });
  assert.deepEqual(r.lines, [{ target: "dish_group", external_id: "10", name: "Виски", rate: 100 }]);
  assert.deepEqual(r.notFound, []);
});

test("бар: нет категории, есть блюдо с тем же именем → блюдо", () => {
  const r = prefillUpsell({
    legacyKind: "bar",
    oldRules: rules([{ id: "sets", label: "Сеты настоек", branches: ["Сет настоек"], rate: 200 }]),
    picker: [item("dish", "20", "Сет настоек")],
  });
  assert.deepEqual(r.lines, [{ target: "dish", external_id: "20", name: "Сет настоек", rate: 200 }]);
});

test("бар: имени нет в номенклатуре → в notFound, строка не создаётся", () => {
  const r = prefillUpsell({
    legacyKind: "bar",
    oldRules: rules([
      { id: "additions", label: "Добавки", branches: ["Сиропы к кофе", " ", "Пюре"], rate: 20 },
    ]),
    picker: [item("dish_group", "30", "Пюре")],
  });
  assert.deepEqual(r.lines, [{ target: "dish_group", external_id: "30", name: "Пюре", rate: 20 }]);
  assert.deepEqual(r.notFound, ["Сиропы к кофе"]);
});

test("бар: архивная позиция уступает действующей, повтор цели не дублирует строку", () => {
  const r = prefillUpsell({
    legacyKind: "bar",
    oldRules: rules([
      { id: "a", label: "А", branches: ["Ром"], rate: 100 },
      { id: "b", label: "Б", branches: ["Ром"], rate: 300 },
    ]),
    picker: [item("dish", "40", "Ром", { archived: true }), item("dish", "41", "Ром")],
  });
  assert.deepEqual(r.lines, [{ target: "dish", external_id: "41", name: "Ром", rate: 100 }]);
});

test("кальяны: три категории по имени → 100 / 250 / 450, «Супер-эксклюзив» не берётся", () => {
  const r = prefillUpsell({
    legacyKind: "masters",
    oldRules: defaultAdditionalRules,
    picker: [
      item("dish_group", "1", "Эксклюзивные кальяны"),
      item("dish_group", "2", "Дегустация"),
      item("dish_group", "3", "Премиальный табак"),
      item("dish_group", "4", "Супер-эксклюзив"),
      item("dish", "5", "Премиальный табак"),
    ],
  });
  assert.deepEqual(r.lines, [
    { target: "dish_group", external_id: "3", name: "Премиальный табак", rate: 100 },
    { target: "dish_group", external_id: "2", name: "Дегустация", rate: 250 },
    { target: "dish_group", external_id: "1", name: "Эксклюзивные кальяны", rate: 450 },
  ]);
  assert.deepEqual(r.notFound, []);
  assert.deepEqual(r.taggedWithoutRate, []);
  assert.deepEqual(r.ratedWithoutTag, []);
});

test("кальяны: категории нет → в notFound", () => {
  const r = prefillUpsell({
    legacyKind: "masters",
    oldRules: defaultAdditionalRules,
    picker: [item("dish_group", "2", "Дегустация")],
  });
  assert.deepEqual(r.lines.map((l) => l.name), ["Дегустация"]);
  assert.deepEqual(r.notFound, ["Премиальный табак", "Эксклюзивные кальяны"]);
});

test("бар: помеченное блюдо вне правил → taggedWithoutRate; без пометки в правилах → ratedWithoutTag", () => {
  const picker = [
    item("dish_group", "10", "Виски"),
    item("dish", "11", "Jameson", { parent: "dish_group:10", tagged: true }),
    item("dish_group", "20", "Вино"),
    item("dish", "21", "Риоха", { parent: "dish_group:20", tagged: true }),
    item("dish", "22", "Старое", { parent: "dish_group:20", tagged: true, archived: true }),
    item("dish_group", "30", "Пюре"),
  ];
  const r = prefillUpsell({
    legacyKind: "bar",
    oldRules: rules([{ id: "x", label: "X", branches: ["Виски", "Пюре"], rate: 100 }]),
    picker,
  });
  // Jameson оплачивается через категорию «Виски» — не в списке; архивное не подсказываем.
  assert.deepEqual(r.taggedWithoutRate, ["Риоха"]);
  assert.deepEqual(r.ratedWithoutTag, ["Пюре"]);
});

test("buildUpsellPicker: пути, пометка тегом «Продажи / Бар», группы и модификаторы", () => {
  const picker = buildUpsellPicker(
    [
      { external_id: "11", kind: "dish", name: "Jameson", group_id: "g2", tags: [{ id: 1, name: "Продажи / Бар" }], archived_at: null },
      { external_id: "12", kind: "dish", name: "Чай", group_id: null, tags: [{ name: "Кухня" }], archived_at: "2026-01-01" },
      { external_id: "13", kind: "modifier", name: "Сироп", group_id: "g3", tags: null, archived_at: null },
    ],
    [
      { id: "g1", external_id: "1", kind: "dish", name: "Бар", parent_group_id: null, store_tags: null },
      { id: "g2", external_id: "2", kind: "dish", name: "Виски", parent_group_id: "g1", store_tags: [{ name: "продажи/бар" }] },
      { id: "g3", external_id: "3", kind: "modifier", name: "Добавки", parent_group_id: null, store_tags: [] },
    ],
  );
  const byKey = new Map(picker.map((p) => [p.key, p]));
  assert.deepEqual(byKey.get("dish:11"), {
    key: "dish:11",
    target: "dish",
    external_id: "11",
    name: "Jameson",
    path: "Бар → Виски",
    parent: "dish_group:2",
    tagged: true,
    archived: false,
  });
  assert.equal(byKey.get("dish:12")?.archived, true);
  assert.equal(byKey.get("dish:12")?.tagged, false);
  assert.equal(byKey.get("dish_group:2")?.path, "Бар");
  assert.equal(byKey.get("dish_group:2")?.tagged, true);
  assert.equal(byKey.get("dish_group:1")?.path, "");
  assert.equal(byKey.get("modifier:13")?.parent, "modifier_group:3");
  assert.equal(byKey.get("modifier_group:3")?.target, "modifier_group");
});
