import test from "node:test";
import assert from "node:assert/strict";

import { isTemplateSort, sortTemplates, templateEarliestSpan } from "./template-order.ts";

const t = (name: string, subtitle: string, start_time: string, end_time: string, variants: { days: number[]; start_time: string; end_time: string }[] = []) =>
  ({ name, subtitle, start_time, end_time, variants });

// Шаблоны как на экране расписания заведения (ноябрь 2026).
const barEvening = t("Бармен", "вечер", "15:00", "03:00", [
  { days: [1, 2, 3, 4, 7], start_time: "15:00", end_time: "03:00" },
  { days: [5, 6], start_time: "17:00", end_time: "04:00" },
]);
const barDay = t("Бармен", "день", "13:00", "03:00");
const cleaner = t("Клинер", "", "12:00", "00:00");
const masterEvening = t("Мастер", "вечер", "17:30", "03:00");
const masterDay = t("Мастер", "день", "12:50", "00:30", [
  { days: [1, 3, 4, 5], start_time: "12:50", end_time: "00:30" },
  { days: [2], start_time: "11:50", end_time: "00:30" },
  { days: [6, 7], start_time: "13:20", end_time: "00:30" },
]);
const manager = t("Менеджер", "", "13:00", "03:00");
const all = [barEvening, barDay, cleaner, masterEvening, masterDay, manager];
const label = (x: { name: string; subtitle: string }) => [x.name, x.subtitle].filter(Boolean).join(" ");

test("по времени: сверху вниз по самому раннему началу за неделю", () => {
  assert.deepEqual(sortTemplates(all, "time").map(label), [
    "Мастер день", // 11:50 во вторник
    "Клинер", // 12:00
    "Бармен день", // 13:00–03:00
    "Менеджер", // 13:00–03:00, равное время — по названию
    "Бармен вечер", // 15:00
    "Мастер вечер", // 17:30
  ]);
});

test("по названию: как раньше — название, затем подзаголовок", () => {
  assert.deepEqual(sortTemplates(all, "name").map(label), [
    "Бармен вечер",
    "Бармен день",
    "Клинер",
    "Мастер вечер",
    "Мастер день",
    "Менеджер",
  ]);
});

test("при равном начале выше та смена, что раньше кончается; конец после полуночи — позже", () => {
  const short = t("Б", "", "10:00", "18:00");
  const overnight = t("А", "", "10:00", "02:00");
  assert.deepEqual(sortTemplates([overnight, short], "time").map(label), ["Б", "А"]);
  assert.deepEqual(templateEarliestSpan(overnight), [600, 26 * 60]);
});

test("время с секундами из базы сравнивается так же", () => {
  assert.deepEqual(
    sortTemplates([t("Поздно", "", "18:00:00", "23:00:00"), t("Рано", "", "09:30:00", "17:00:00")], "time").map(label),
    ["Рано", "Поздно"],
  );
});

test("исходный массив не меняется", () => {
  const list = [barEvening, cleaner];
  sortTemplates(list, "time");
  assert.deepEqual(list, [barEvening, cleaner]);
});

test("isTemplateSort пропускает только известные значения", () => {
  assert.equal(isTemplateSort("time"), true);
  assert.equal(isTemplateSort("name"), true);
  assert.equal(isTemplateSort("manual"), false);
  assert.equal(isTemplateSort(null), false);
});
