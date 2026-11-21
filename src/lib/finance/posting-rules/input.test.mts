import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizePostingRuleInput } from "./input.ts";

const categoryTypes = new Map<string, "income" | "expense" | "mixed">([
  ["cat-supply", "expense"],
  ["cat-revenue", "income"],
  ["cat-mixed", "mixed"],
]);

const sber = { field: "bank_account", op: "in", ids: ["acc-sber"] };

function errorOf(input: unknown): string | null {
  const result = normalizePostingRuleInput(input, categoryTypes);
  return result.ok ? null : result.error;
}

function valueOf(input: unknown) {
  const result = normalizePostingRuleInput(input, categoryTypes);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

test("без условий — ошибка", () => {
  assert.equal(
    errorOf({ conditions: [], actions: { venue_id: "v-1" } }),
    "Добавьте хотя бы одно условие",
  );
});

test("без действий — ошибка", () => {
  assert.equal(
    errorOf({ conditions: [sber], actions: { category_id: null } }),
    "Добавьте хотя бы одно действие",
  );
});

test("пустой текст в условии «Описание» — ошибка", () => {
  assert.equal(
    errorOf({
      conditions: [{ field: "description", op: "contains", value: "   " }],
      actions: { venue_id: "v-1" },
    }),
    "Введите текст в условии «Описание»",
  );
});

test("сумма «от» больше «до» — ошибка, обе пустые — ошибка", () => {
  assert.equal(
    errorOf({
      conditions: [{ field: "amount", op: "between", min: 500, max: 100 }],
      actions: { venue_id: "v-1" },
    }),
    "В условии «Сумма» значение «от» больше, чем «до»",
  );
  assert.equal(
    errorOf({
      conditions: [{ field: "amount", op: "between", min: null, max: null }],
      actions: { venue_id: "v-1" },
    }),
    "Укажите границу в условии «Сумма»",
  );
});

test("пустой список в условии — ошибка", () => {
  assert.equal(
    errorOf({ conditions: [{ field: "counterparty", op: "in", ids: [] }], actions: { venue_id: "v-1" } }),
    "Выберите значение в условии «Контрагент»",
  );
});

test("два условия на одно поле — ошибка, кроме описания", () => {
  assert.equal(
    errorOf({
      conditions: [sber, { field: "bank_account", op: "in", ids: ["acc-tbank"] }],
      actions: { venue_id: "v-1" },
    }),
    "Условие «Счёт» уже есть в правиле",
  );
  assert.equal(
    errorOf({
      conditions: [
        { field: "description", op: "contains", value: "СБП" },
        { field: "description", op: "not_contains", value: "возврат" },
      ],
      actions: { venue_id: "v-1" },
    }),
    null,
  );
});

test("ИНН — 10 или 12 цифр", () => {
  assert.equal(
    errorOf({
      conditions: [{ field: "counterparty_inn", op: "eq", value: "77190" }],
      actions: { venue_id: "v-1" },
    }),
    "ИНН — 10 или 12 цифр",
  );
  const value = valueOf({
    conditions: [{ field: "counterparty_inn", op: "eq", value: " 7719089011 " }],
    actions: { venue_id: "v-1" },
  });
  assert.deepEqual(value.conditions, [{ field: "counterparty_inn", op: "eq", value: "7719089011" }]);
});

test("статья расхода добавляет условие на тип", () => {
  const value = valueOf({ conditions: [sber], actions: { category_id: "cat-supply" } });
  assert.deepEqual(value.conditions, [sber, { field: "type", op: "eq", value: "expense" }]);
});

test("смешанная статья условие на тип не добавляет", () => {
  const value = valueOf({ conditions: [sber], actions: { category_id: "cat-mixed" } });
  assert.deepEqual(value.conditions, [sber]);
});

test("статья другого типа, чем в условии, — ошибка", () => {
  assert.equal(
    errorOf({
      conditions: [sber, { field: "type", op: "eq", value: "expense" }],
      actions: { category_id: "cat-revenue" },
    }),
    "Статья для приходов, а правило — для расходов",
  );
});

test("неизвестная статья — ошибка", () => {
  assert.equal(
    errorOf({ conditions: [sber], actions: { category_id: "cat-gone" } }),
    "Статья не найдена",
  );
});

test("название обрезается, пустое становится null, включено по умолчанию", () => {
  assert.equal(valueOf({ name: "  Поставки  ", conditions: [sber], actions: { venue_id: "v-1" } }).name, "Поставки");
  const empty = valueOf({ name: "   ", conditions: [sber], actions: { venue_id: "v-1" } });
  assert.equal(empty.name, null);
  assert.equal(empty.enabled, true);
});

test("повторы в списке убираются, пустые действия отбрасываются", () => {
  const value = valueOf({
    conditions: [{ field: "counterparty", op: "in", ids: ["cp-a", "cp-b", "cp-a"] }],
    actions: { venue_id: "v-1", counterparty_id: null },
  });
  assert.deepEqual(value.conditions, [{ field: "counterparty", op: "in", ids: ["cp-a", "cp-b"] }]);
  assert.deepEqual(value.actions, { venue_id: "v-1" });
});

test("неизвестное поле условия — ошибка", () => {
  assert.equal(
    errorOf({ conditions: [{ field: "tag", op: "eq", value: "x" }], actions: { venue_id: "v-1" } }),
    "Правило заполнено с ошибкой",
  );
});

test("условия из базы: годные читаются, испорченные дают null", async () => {
  const { parseStoredConditions } = await import("./input.ts");
  assert.deepEqual(parseStoredConditions([{ field: "type", op: "eq", value: "income" }]), [
    { field: "type", op: "eq", value: "income" },
  ]);
  assert.equal(parseStoredConditions([{ field: "counterparty", op: "in" }]), null);
  assert.equal(parseStoredConditions([{ field: "tag", op: "eq", value: "x" }]), null);
  assert.equal(parseStoredConditions("oops"), null);
});

test("лимит условий считается вместе с автоматическим условием на тип", () => {
  const twenty = Array.from({ length: 20 }, (_, i) => ({ field: "description", op: "contains", value: `т${i}` }));
  assert.equal(
    errorOf({ conditions: twenty, actions: { category_id: "cat-supply" } }),
    "Условий не больше 20, считая условие на тип операции",
  );
  assert.equal(errorOf({ conditions: twenty, actions: { category_id: "cat-mixed" } }), null);
});
