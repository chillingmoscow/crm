import test from "node:test";
import assert from "node:assert/strict";

import { describeShiftChange, type HistoryContext } from "./shift-history.ts";

const ctx: HistoryContext = {
  date: (iso) => iso.slice(5, 10),
  time: (iso) => iso.slice(11, 16),
  person: (key) => (key ? { u1: "Анна", u2: "Борис", "payroll:p1": "Полина" }[key] ?? "?" : "Без сотрудника"),
  role: (id) => (id ? { r1: "Бармен", r2: "Клинер" }[id] ?? "?" : "Без должности"),
  template: (id) => (id ? "Бар · вечер" : ""),
};

const base = {
  starts_at: "2026-11-17T09:00",
  ends_at: "2026-11-17T17:00",
  user_id: "u1",
  payroll_employee_id: null,
  role_id: "r1",
  template_id: null,
  title: "Смена",
  color: "blue",
  note: "",
  published: false,
};

test("создание — дата, время и сотрудник", () => {
  assert.deepEqual(describeShiftChange("shift.create", null, base, ctx), ["11-17, 09:00–17:00", "Анна"]);
});

test("перенос на другой день и сотрудника", () => {
  const after = { ...base, starts_at: "2026-11-19T09:00", ends_at: "2026-11-19T17:00", user_id: null, payroll_employee_id: "p1" };
  assert.deepEqual(describeShiftChange("shift.edit", base, after, ctx), [
    "Дата: 11-17 → 11-19",
    "Сотрудник: Анна → Полина",
  ]);
});

test("время, должность, заметка и цвет", () => {
  const after = { ...base, starts_at: "2026-11-17T14:00", role_id: "r2", note: "ключи у охраны", color: "red" };
  assert.deepEqual(describeShiftChange("shift.edit", base, after, ctx), [
    "Время: 09:00–17:00 → 14:00–17:00",
    "Должность: Бармен → Клинер",
    "Добавлена заметка",
    "Изменён цвет",
  ]);
});

test("смена шаблона не дублирует строку про название", () => {
  const after = { ...base, template_id: "t1", title: "Бар" };
  assert.deepEqual(describeShiftChange("shift.edit", base, after, ctx), ["Шаблон: Бар · вечер"]);
});

test("публикация отдельным действием не повторяется в описании", () => {
  assert.deepEqual(describeShiftChange("shift.publish", base, { ...base, published: true }, ctx), []);
});

import { collapseHistory, shiftChangeTitle } from "./shift-history.ts";

test("заголовок называет конкретное изменение", () => {
  const moved = { ...base, starts_at: "2026-11-19T09:00", ends_at: "2026-11-19T17:00" };
  assert.equal(shiftChangeTitle("shift.edit", base, moved, ctx), "Перенесена на другой день");
  assert.equal(shiftChangeTitle("shift.assign", base, { ...base, user_id: "u2" }, ctx), "Замена сотрудника");
  assert.equal(shiftChangeTitle("shift.assign", { ...base, user_id: null }, base, ctx), "Назначен сотрудник");
  assert.equal(
    shiftChangeTitle("shift.edit", base, { ...moved, starts_at: "2026-11-19T10:00" }, ctx),
    "Изменены дата и время",
  );
  assert.equal(shiftChangeTitle("shift.create", null, base, ctx), "Смена создана");
});

test("сохранение без изменений не показываем", () => {
  assert.equal(shiftChangeTitle("shift.edit", base, { ...base }, ctx), null);
});

test("быстрые правки одного человека склеиваются; туда-обратно — без изменений", () => {
  const d17 = { ...base, starts_at: "2026-11-17T09:00", ends_at: "2026-11-17T17:00" };
  const d18 = { ...base, starts_at: "2026-11-18T09:00", ends_at: "2026-11-18T17:00" };
  const ev = (id: string, at: string, before: object, after: object, actor = "a") => ({
    id, action: "shift.edit", actor_id: actor, created_at: at, details: { before, after },
  });
  const events = [
    ev("4", "2026-11-17T22:35:40Z", d17, d18),
    ev("3", "2026-11-17T22:35:30Z", d18, d17),
    ev("2", "2026-11-17T22:35:20Z", d17, d18),
    ev("1", "2026-11-17T22:35:10Z", d18, d17),
    ev("0", "2026-11-17T16:37:00Z", d17, d17),
  ];
  const collapsed = collapseHistory(events);
  assert.equal(collapsed.length, 2);
  assert.equal(collapsed[0].id, "4");
  const merged = collapsed[0].details as { before: typeof base; after: typeof base };
  assert.equal(shiftChangeTitle("shift.edit", merged.before, merged.after, ctx), null);
  // Другой человек — отдельная запись.
  assert.equal(collapseHistory([ev("b", "2026-11-17T22:36:00Z", d18, d17, "b"), ...events]).length, 3);
});
