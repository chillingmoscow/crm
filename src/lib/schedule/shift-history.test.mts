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
