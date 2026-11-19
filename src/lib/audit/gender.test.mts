import { test } from "node:test";
import assert from "node:assert/strict";
import { genderizeText } from "./gender.ts";

test("мужской род убирает окончание", () => {
  assert.equal(genderizeText("изменил(а) анкету", "male"), "изменил анкету");
  assert.equal(genderizeText("перенёс(ла) смену", "male"), "перенёс смену");
  assert.equal(genderizeText("учёл(ла) записи", "male"), "учёл записи");
});

test("женский род подставляет окончание", () => {
  assert.equal(genderizeText("изменил(а) анкету", "female"), "изменила анкету");
  assert.equal(genderizeText("провёл(а) операции", "female"), "провела операции");
  assert.equal(genderizeText("подвёл(а) итоги", "female"), "подвела итоги");
  assert.equal(genderizeText("перенёс(ла) смену", "female"), "перенесла смену");
  assert.equal(genderizeText("учёл(ла) записи", "female"), "учла записи");
});

test("несколько глаголов в одной фразе", () => {
  assert.equal(
    genderizeText("создал(а) и отправил(а)", "female"),
    "создала и отправила",
  );
});

test("без пола фраза не меняется", () => {
  assert.equal(genderizeText("изменил(а) анкету", null), "изменил(а) анкету");
  assert.equal(genderizeText("изменил(а) анкету", undefined), "изменил(а) анкету");
});

test("скобки, не похожие на окончание, не трогаются", () => {
  assert.equal(genderizeText("Касса (основная)", "male"), "Касса (основная)");
});
