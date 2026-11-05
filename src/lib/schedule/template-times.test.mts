import test from "node:test";
import assert from "node:assert/strict";

import {
  TEMPLATE_VARIANT_ERRORS,
  templateTimesFor,
  validateVariants,
  type TemplateVariant,
} from "./template-times.ts";

const masterDay: TemplateVariant[] = [
  { days: [1, 3, 4, 5], start_time: "12:50", end_time: "00:30" },
  { days: [2], start_time: "11:50", end_time: "00:30" },
  { days: [6, 7], start_time: "13:20", end_time: "00:30" },
];
const master = { start_time: "12:50", end_time: "00:30", variants: masterDay };

test("пустые варианты: время шаблона на любой день", () => {
  const t = { start_time: "09:00", end_time: "17:00", variants: [] };
  for (let d = 1; d <= 7; d++)
    assert.deepEqual(templateTimesFor(t, d), {
      start_time: "09:00",
      end_time: "17:00",
    });
});

test("«Мастер · день»: ВТ → 11:50–00:30, СБ → 13:20–00:30, ПН → 12:50–00:30", () => {
  assert.deepEqual(templateTimesFor(master, 2), {
    start_time: "11:50",
    end_time: "00:30",
  });
  assert.deepEqual(templateTimesFor(master, 6), {
    start_time: "13:20",
    end_time: "00:30",
  });
  assert.deepEqual(templateTimesFor(master, 1), {
    start_time: "12:50",
    end_time: "00:30",
  });
  assert.equal(validateVariants(masterDay), null);
});

test("день вне вариантов → null", () => {
  const t = {
    start_time: "10:00",
    end_time: "18:00",
    variants: [{ days: [1, 2], start_time: "10:00", end_time: "18:00" }],
  };
  assert.equal(templateTimesFor(t, 3), null);
  assert.equal(templateTimesFor(t, 7), null);
});

test("повтор дня → ошибка (внутри и между вариантами)", () => {
  assert.equal(
    validateVariants([
      { days: [1, 2], start_time: "10:00", end_time: "18:00" },
      { days: [2, 3], start_time: "11:00", end_time: "19:00" },
    ]),
    "Дни недели в вариантах шаблона не должны повторяться",
  );
  assert.equal(
    validateVariants([
      { days: [4, 4], start_time: "10:00", end_time: "18:00" },
    ]),
    TEMPLATE_VARIANT_ERRORS.duplicateDays,
  );
});

test("вариант без дней → ошибка", () => {
  assert.equal(
    validateVariants([{ days: [], start_time: "10:00", end_time: "18:00" }]),
    TEMPLATE_VARIANT_ERRORS.noDays,
  );
});

test("пустой список вариантов допустим", () => {
  assert.equal(validateVariants([]), null);
});

test("день вне 1..7 и не целое → ошибка", () => {
  for (const d of [0, 8, 1.5])
    assert.equal(
      validateVariants([{ days: [d], start_time: "10:00", end_time: "18:00" }]),
      TEMPLATE_VARIANT_ERRORS.badDay,
    );
});

test("больше 7 вариантов → ошибка", () => {
  const v = Array.from({ length: 8 }, (_, i) => ({
    days: [(i % 7) + 1],
    start_time: "10:00",
    end_time: "18:00",
  }));
  assert.equal(validateVariants(v), TEMPLATE_VARIANT_ERRORS.tooMany);
});

test("неверное время → ошибка", () => {
  for (const [s, e] of [
    ["25:00", "18:00"],
    ["10:60", "18:00"],
    ["10:00", "1800"],
  ])
    assert.equal(
      validateVariants([{ days: [1], start_time: s, end_time: e }]),
      TEMPLATE_VARIANT_ERRORS.badTime,
    );
});

test("перерыв должен быть короче каждого варианта (с переходом через полночь)", () => {
  const v = [
    { days: [1], start_time: "23:00", end_time: "01:00" }, // 120 мин
    { days: [2], start_time: "10:00", end_time: "18:00" },
  ];
  assert.equal(validateVariants(v, 119), null);
  assert.equal(validateVariants(v, 120), TEMPLATE_VARIANT_ERRORS.breakTooLong);
  // начало = концу — сутки
  assert.equal(
    validateVariants(
      [{ days: [1], start_time: "09:00", end_time: "09:00" }],
      1439,
    ),
    null,
  );
});
