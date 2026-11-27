import test from "node:test";
import assert from "node:assert/strict";
import { reconcileDay, type Withdrawal } from "./payout-reconcile.ts";

const tips = /ча[йеюёвы]/iu;
const other = [/инкас|инк.*ация/iu, /такси/iu];
const day = (withdrawals: Withdrawal[], issued = 110000, names = ["Гамлет Арутюнян", "Анна Иванова"]) =>
  reconcileDay({ issued, withdrawals, names, tips, other });

test("сверка: одно изъятие на всю сумму дня — сошлось", () => {
  const r = day([
    { id: 1, amount: 5000, comment: "сейф" },
    { id: 2, amount: 110000, comment: "ЗП" },
  ]);
  assert.deepEqual(r, { state: "matched", withdrawn: 110000, ids: [2] });
});

test("сверка: сумма совпала и без комментария", () => {
  assert.deepEqual(day([{ id: 7, amount: 110000, comment: "" }]).ids, [7]);
});

test("сверка: из двух равных изъятий берём то, что с «ЗП»", () => {
  const r = day([
    { id: 3, amount: 110000, comment: "инкассация" },
    { id: 4, amount: 110000, comment: "з/п" },
  ]);
  assert.deepEqual(r.ids, [4]);
});

test("сверка: по изъятию на человека — набор с именами или «ЗП» на сумму дня", () => {
  const r = day([
    { id: 10, amount: 65000, comment: "Гамлет" },
    { id: 11, amount: 45000, comment: "зп Анна" },
    { id: 12, amount: 3000, comment: "такси" },
  ]);
  assert.deepEqual(r, { state: "matched", withdrawn: 110000, ids: [10, 11] });
});

test("сверка: не сошлось — изъято столько, сколько похоже на зарплату", () => {
  const r = day([
    { id: 20, amount: 65000, comment: "ЗП" },
    { id: 21, amount: 3000, comment: "такси" },
  ]);
  assert.deepEqual(r, { state: "mismatch", withdrawn: 65000, ids: [] });
});

test("сверка: чаевые на ту же сумму не засчитываются", () => {
  const r = day([{ id: 30, amount: 110000, comment: "чаевые" }]);
  assert.equal(r.state, "mismatch");
  assert.equal(r.withdrawn, 0);
});

test("сверка: «ЗП» в комментарии важнее слова про чаевые", () => {
  assert.equal(day([{ id: 31, amount: 110000, comment: "зп + чай" }]).state, "matched");
});

test("сверка: часть имени внутри другого слова — не имя", () => {
  // «анна» не должна совпасть со словом «ванна».
  const r = day([
    { id: 40, amount: 65000, comment: "ЗП" },
    { id: 41, amount: 45000, comment: "ванна" },
  ]);
  assert.equal(r.state, "mismatch");
  assert.equal(r.withdrawn, 65000);
});

test("сверка: копейки сравниваются точно", () => {
  assert.equal(day([{ id: 50, amount: 7500.5, comment: "" }], 7500.5).state, "matched");
  assert.equal(day([{ id: 51, amount: 7500, comment: "" }], 7500.5).state, "mismatch");
});

test("сверка: инкассация или такси на ту же сумму — не зарплата", () => {
  assert.equal(day([{ id: 60, amount: 110000, comment: "инкассация в сейф" }]).state, "mismatch");
  assert.equal(day([{ id: 61, amount: 110000, comment: "такси" }]).state, "mismatch");
});
