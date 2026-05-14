import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizePhone,
  formatPhoneDisplay,
  formatPhonePartial,
} from "./phone.ts";

test("normalizePhone: 8XXXXXXXXXX → +7XXXXXXXXXX", () => {
  assert.equal(normalizePhone("89254479934"), "+79254479934");
});

test("normalizePhone: +7XXXXXXXXXX passthrough", () => {
  assert.equal(normalizePhone("+79254479934"), "+79254479934");
});

test("normalizePhone: 7XXXXXXXXXX (без плюса)", () => {
  assert.equal(normalizePhone("79254479934"), "+79254479934");
});

test("normalizePhone: 10-digit subscriber → +7XXXXXXXXXX", () => {
  assert.equal(normalizePhone("9254479934"), "+79254479934");
});

test("normalizePhone: с пробелами/скобками/дефисами", () => {
  assert.equal(normalizePhone("+7 (925) 447-99-34"), "+79254479934");
  assert.equal(normalizePhone("8 925 447 99 34"), "+79254479934");
});

test("normalizePhone: слишком короткое → null", () => {
  assert.equal(normalizePhone("925447"), null);
});

test("normalizePhone: слишком длинное → null", () => {
  assert.equal(normalizePhone("123456789012345"), null);
});

test("normalizePhone: пусто/null/undefined → null", () => {
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone(undefined), null);
});

test("formatPhoneDisplay: E.164 → +7 (XXX) XXX-XX-XX", () => {
  assert.equal(formatPhoneDisplay("+79254479934"), "+7 (925) 447-99-34");
});

test("formatPhoneDisplay: raw user input тоже форматируется", () => {
  assert.equal(formatPhoneDisplay("89254479934"), "+7 (925) 447-99-34");
});

test("formatPhoneDisplay: невалидный legacy → as-is", () => {
  assert.equal(formatPhoneDisplay("abc"), "abc");
});

test("formatPhoneDisplay: пусто → пустая строка", () => {
  assert.equal(formatPhoneDisplay(""), "");
  assert.equal(formatPhoneDisplay(null), "");
});

test("formatPhonePartial: пошаговый ввод", () => {
  assert.equal(formatPhonePartial(""), "");
  assert.equal(formatPhonePartial("8"), "+7 ");
  assert.equal(formatPhonePartial("89"), "+7 (9");
  assert.equal(formatPhonePartial("892"), "+7 (92");
  assert.equal(formatPhonePartial("8925"), "+7 (925");
  assert.equal(formatPhonePartial("89254"), "+7 (925) 4");
  assert.equal(formatPhonePartial("8925447"), "+7 (925) 447");
  assert.equal(formatPhonePartial("89254479"), "+7 (925) 447-9");
  assert.equal(formatPhonePartial("892544799"), "+7 (925) 447-99");
  assert.equal(formatPhonePartial("8925447993"), "+7 (925) 447-99-3");
  assert.equal(formatPhonePartial("89254479934"), "+7 (925) 447-99-34");
});

test("formatPhonePartial: лишние цифры отсекаются", () => {
  assert.equal(formatPhonePartial("892544799341111"), "+7 (925) 447-99-34");
});

test("round-trip: normalize → format → normalize стабильно", () => {
  const e164 = normalizePhone("8 (925) 447-99-34");
  assert.equal(e164, "+79254479934");
  const display = formatPhoneDisplay(e164!);
  assert.equal(display, "+7 (925) 447-99-34");
  assert.equal(normalizePhone(display), "+79254479934");
});
