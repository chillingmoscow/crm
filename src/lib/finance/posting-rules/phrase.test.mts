import { test } from "node:test";
import assert from "node:assert/strict";

import { describePostingRule, type RuleNames } from "./phrase.ts";

const NAMES: Record<string, string> = {
  "cp-a": "ООО «А»",
  "cp-b": "ООО «Б»",
  "g-1": "Поставщики",
  "acc-sber": "СБЕР Бизнес",
  "acc-tbank": "Т-Банк",
  "cat-supply": "Поставки",
  "v-chilling": "CHILLING",
};

const names: RuleNames = { lookup: (_kind, id) => NAMES[id] ?? null };

/** Форматтер денег ставит неразрывные пробелы — в тестах сравниваем обычные. */
function plain(value: { conditions: string; actions: string }) {
  return {
    conditions: value.conditions.replace(/\s/g, " "),
    actions: value.actions.replace(/\s/g, " "),
  };
}

test("контрагенты, счёт и тип читаются фразой", () => {
  assert.deepEqual(
    plain(
      describePostingRule(
        {
          conditions: [
            { field: "counterparty", op: "in", ids: ["cp-a", "cp-b"] },
            { field: "bank_account", op: "in", ids: ["acc-sber"] },
            { field: "type", op: "eq", value: "expense" },
          ],
          actions: { category_id: "cat-supply", venue_id: "v-chilling" },
        },
        names,
      ),
    ),
    {
      conditions: "контрагент — один из: ООО «А», ООО «Б»; счёт — СБЕР Бизнес; расход",
      actions: "статья «Поставки», заведение CHILLING",
    },
  );
});

test("недоступное заведение и счёт показываются без названия", () => {
  assert.deepEqual(
    plain(
      describePostingRule(
        {
          conditions: [{ field: "bank_account", op: "in", ids: ["acc-hidden"] }],
          actions: { category_id: "cat-supply", venue_id: "v-hidden" },
        },
        names,
      ),
    ),
    { conditions: "счёт — другой счёт", actions: "статья «Поставки», другое заведение" },
  );
});

test("сумма от и до", () => {
  const phrase = (min: number | null, max: number | null) =>
    plain(
      describePostingRule(
        { conditions: [{ field: "amount", op: "between", min, max }], actions: {} },
        names,
      ),
    ).conditions;
  assert.equal(phrase(100, 5000), "сумма от 100 до 5 000 ₽");
  assert.equal(phrase(100, null), "сумма от 100 ₽");
  assert.equal(phrase(null, 5000), "сумма до 5 000 ₽");
});

test("описание, ИНН, группа, «ни один из», приход", () => {
  assert.equal(
    describePostingRule(
      {
        conditions: [
          { field: "description", op: "contains", value: "Комиссия СБП" },
          { field: "description", op: "not_contains", value: "возврат" },
          { field: "counterparty_inn", op: "eq", value: "7719089011" },
          { field: "counterparty_group", op: "in", ids: ["g-1"] },
          { field: "counterparty", op: "not_in", ids: ["cp-a"] },
          { field: "type", op: "eq", value: "income" },
        ],
        actions: { counterparty_id: "cp-b" },
      },
      names,
    ).conditions,
    "описание содержит «Комиссия СБП»; описание не содержит «возврат»; ИНН контрагента — 7719089011; группа контрагентов — Поставщики; контрагент — не ООО «А»; приход",
  );
});

test("контрагент в действии и описание «равно» / «начинается с»", () => {
  assert.deepEqual(
    describePostingRule(
      {
        conditions: [
          { field: "description", op: "eq", value: "Аренда" },
          { field: "description", op: "starts_with", value: "Оплата" },
        ],
        actions: { counterparty_id: "cp-a" },
      },
      names,
    ),
    {
      conditions: "описание — «Аренда»; описание начинается с «Оплата»",
      actions: "контрагент ООО «А»",
    },
  );
});
