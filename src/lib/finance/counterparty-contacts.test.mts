import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeContacts, normalizeTelegram, normalizeWeekdays, telegramUrl } from "./counterparty-contacts.ts";

const TG_ERROR = "Telegram: ник из 5–32 латинских букв, цифр и _";

test("normalizeTelegram принимает ник, @ник и ссылки", () => {
  assert.deepEqual(normalizeTelegram("@Ivan_Petrov"), { value: "Ivan_Petrov", error: null });
  assert.deepEqual(normalizeTelegram("t.me/ivan_p"), { value: "ivan_p", error: null });
  assert.deepEqual(normalizeTelegram(" https://t.me/ivan_p/ "), { value: "ivan_p", error: null });
  assert.deepEqual(normalizeTelegram("ivan_p"), { value: "ivan_p", error: null });
  assert.deepEqual(normalizeTelegram("  "), { value: null, error: null });
});
test("normalizeTelegram отказывает на кириллице и коротком нике", () => {
  assert.deepEqual(normalizeTelegram("иван"), { value: null, error: TG_ERROR });
  assert.deepEqual(normalizeTelegram("@abc"), { value: null, error: TG_ERROR });
});
test("telegramUrl", () => {
  assert.equal(telegramUrl("ivan_p"), "https://t.me/ivan_p");
});
test("normalizeContacts отбрасывает пустые и чистит поля", () => {
  const result = normalizeContacts([
    { name: " Иван ", role: " менеджер ", phone: "", email: " i@x.ru ", telegram: "@ivan_petrov" },
    { name: "", role: "", phone: "", email: "", telegram: "" },
  ]);
  assert.deepEqual(result, {
    contacts: [{ name: "Иван", role: "менеджер", phone: null, email: "i@x.ru", telegram: "ivan_petrov" }],
    error: null,
  });
});
test("normalizeContacts: контакт без имени получает имя «Контакт»", () => {
  assert.deepEqual(normalizeContacts([{ name: "", phone: "+79990000000" }]), {
    contacts: [{ name: "Контакт", role: null, phone: "+79990000000", email: null, telegram: null }],
    error: null,
  });
});
test("normalizeContacts: старая почта из базы не мешает сохранить", () => {
  const trusted = new Set(["a@x.ru, b@y.ru"]);
  assert.equal(normalizeContacts([{ name: "Иван", email: "a@x.ru, b@y.ru" }], { trustedEmails: trusted }).error, null);
  assert.equal(normalizeContacts([{ name: "Иван", email: "c@" }], { trustedEmails: trusted }).error, "Проверьте адрес почты");
});
test("normalizeContacts: длинные поля обрезаются", () => {
  const [c] = normalizeContacts([{ name: "я".repeat(300), role: "р".repeat(300), phone: "1".repeat(80) }]).contacts;
  assert.equal(c.name.length, 200);
  assert.equal(c.role?.length, 100);
  assert.equal(c.phone?.length, 30);
});
test("normalizeContacts: плохая почта, плохой Telegram, больше 10", () => {
  assert.equal(normalizeContacts([{ name: "Иван", email: "ivan@" }]).error, "Проверьте адрес почты");
  assert.equal(normalizeContacts([{ name: "Иван", telegram: "иван" }]).error, TG_ERROR);
  assert.equal(
    normalizeContacts(Array.from({ length: 11 }, (_, i) => ({ name: `К${i}` }))).error,
    "Не больше 10 контактов",
  );
  assert.deepEqual(normalizeContacts("мусор"), { contacts: [], error: null });
});
test("normalizeWeekdays", () => {
  assert.deepEqual(normalizeWeekdays([3, 1, 3, 9, "2", 0]), [1, 3]);
  assert.deepEqual(normalizeWeekdays(null), []);
});
