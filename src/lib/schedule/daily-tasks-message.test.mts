import test from "node:test";
import assert from "node:assert/strict";

import {
  businessDayLabel,
  dailyTasksMessage,
  visibleLength,
} from "./daily-tasks-message.ts";

const base = "https://sheerly.app/";
const day = "https://sheerly.app/schedule?showTasks=1&amp;date=2026-11-26";

test("дата в заголовке — день недели и число", () => {
  assert.equal(businessDayLabel("2026-11-26"), "четверг, 26 ноября");
  assert.equal(businessDayLabel("26.11.2026"), "сегодня");
});

test("задачи сгруппированы по исполнителям, без исполнителя — в конце", () => {
  const text = dailyTasksMessage(
    [
      { id: "t2", name: "Уборка кассовой зоны", employee: "Наталия Копылова", blocked: "" },
      { id: "t1", name: "Заточка ножей", employee: null, blocked: "Нет смены" },
      { id: "t3", name: "Вымыть подсвечники", employee: "Наталия Копылова", blocked: "" },
      { id: "t4", name: "Чистка чайной посуды", employee: "Анна Иванова", blocked: "" },
    ],
    "2026-11-26",
    base,
  );
  assert.equal(
    text,
    [
      "✅ <b>Задачи на четверг, 26 ноября</b>",
      `👤 <b>Анна Иванова</b>\n• <a href="${day}&amp;task=t4">Чистка чайной посуды</a>`,
      `👤 <b>Наталия Копылова</b>\n• <a href="${day}&amp;task=t3">Вымыть подсвечники</a>\n• <a href="${day}&amp;task=t2">Уборка кассовой зоны</a>`,
      `⚠️ <b>Без исполнителя</b> — назначьте в расписании\n• <a href="${day}&amp;task=t1">Заточка ножей</a>`,
      `Заполните чек-листы и приложите фото к нужным пунктам.\n<a href="${day}">Все задачи дня в расписании</a>`,
    ].join("\n\n"),
  );
});

test("назначенная задача с проблемой помечена, названия экранируются", () => {
  const text = dailyTasksMessage(
    [{ id: "t1", name: "Чай <улун> & кофе", employee: "Анна", blocked: "Смена изменилась" }],
    "2026-11-26",
    base,
  );
  assert.match(text, />Чай &lt;улун&gt; &amp; кофе<\/a> — проверьте назначение/);
});

test("старые сообщения без id — названия без ссылок", () => {
  const text = dailyTasksMessage(
    [{ name: "Заточка ножей", employee: "Анна", blocked: "" }],
    "2026-11-26",
    base,
  );
  assert.match(text, /\n• Заточка ножей\n/);
});

test("длинный список — короткая сводка со ссылкой на день", () => {
  const tasks = Array.from({ length: 120 }, (_, i) => ({
    id: `t${i}`,
    name: `Очень длинное название задачи номер ${i} с подробностями`,
    employee: `Сотрудник ${i % 7}`,
    blocked: "",
  }));
  const text = dailyTasksMessage(tasks, "2026-11-26", base);
  assert.match(text, /Задач: 120\. Полный список и чек-листы — в Sheerly\./);
  assert.ok(visibleLength(text) < 3900);
});

test("больше 50 задач — без ссылок на каждую, если влезает", () => {
  const tasks = Array.from({ length: 60 }, (_, i) => ({
    id: `t${i}`,
    name: `Задача ${i}`,
    employee: "Анна",
    blocked: "",
  }));
  const text = dailyTasksMessage(tasks, "2026-11-26", base);
  assert.doesNotMatch(text, /task=/);
  assert.match(text, /• Задача 0\n/);
});
