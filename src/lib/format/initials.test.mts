import { test } from "node:test";
import assert from "node:assert/strict";
import { personInitials } from "./initials.ts";

test("две буквы из имени и фамилии", () => {
  assert.equal(personInitials("Тест Владелец"), "ТВ");
  assert.equal(personInitials("  иван   петров  сергеевич "), "ИП");
});

test("одно слово — одна буква", () => {
  assert.equal(personInitials("Владелец"), "В");
});

test("пустое имя — вопрос", () => {
  assert.equal(personInitials(""), "?");
  assert.equal(personInitials("   "), "?");
  assert.equal(personInitials(null), "?");
  assert.equal(personInitials(undefined), "?");
});

test("разделители не считаются словами", () => {
  assert.equal(personInitials("Анна · тест"), "АТ");
  assert.equal(personInitials("Иван — бар"), "ИБ");
  assert.equal(personInitials("· ·"), "?");
});

test("не режет суррогатные пары", () => {
  assert.equal(personInitials("𝐀нна Тест"), "𝐀Т");
});
