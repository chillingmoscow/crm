import test from "node:test";
import assert from "node:assert/strict";

import {
  buildImageGroups,
  buildScheduleImage,
  scheduleImageCaption,
  scheduleImageFileName,
  splitImageParts,
  teamVisibleShifts,
  weekPeriodLabel,
  type ImageGroup,
  type ImageShift,
  type ScheduleImageInput,
} from "./schedule-image.ts";

const week = "2026-11-23"; // понедельник
let seq = 0;
const shift = (over: Partial<ImageShift> = {}): ImageShift => ({
  id: `s${++seq}`,
  published: true,
  // 10:00–22:00 по Москве
  starts_at: "2026-11-23T07:00:00Z",
  ends_at: "2026-11-23T19:00:00Z",
  user_id: "u1",
  payroll_employee_id: null,
  department_id: "kitchen",
  role_id: "cook",
  template_id: null,
  color: "orange",
  ...over,
});
const input = (shifts: ImageShift[], over: Partial<ScheduleImageInput> = {}): ScheduleImageInput => ({
  venueName: "Кафе",
  timezone: "Europe/Moscow",
  week,
  department: null,
  shifts,
  people: [
    { key: "u1", name: "Анна Белова", role: "Повар" },
    { key: "u2", name: "Борис Волков", role: "Бармен" },
    { key: "u3", name: "Вера Глебова", role: "Повар" },
    { key: "payroll:p1", name: "Гоша", role: "Повар · разовый" },
  ],
  departments: [
    { id: "kitchen", name: "Кухня" },
    { id: "bar", name: "Бар" },
  ],
  roles: [
    { id: "cook", name: "Повар" },
    { id: "barman", name: "Бармен" },
    { id: "chef", name: "Су-шеф" },
  ],
  templateColors: {},
  ...over,
});

test("teamVisibleShifts: только опубликованные смены с сотрудником на этой неделе", () => {
  const visible = shift();
  const draft = shift({ published: false });
  const open = shift({ user_id: null });
  const casual = shift({ user_id: null, payroll_employee_id: "p1" });
  const nextWeek = shift({ starts_at: "2026-11-30T07:00:00Z", ends_at: "2026-11-30T19:00:00Z" });
  // 23:30 воскресенья по Москве — ещё эта неделя, хотя в UTC это 20:30.
  const sundayLate = shift({ starts_at: "2026-11-29T20:30:00Z", ends_at: "2026-11-30T05:00:00Z" });
  // 01:00 понедельника по Москве — 22:00 воскресенья прошлой недели по UTC.
  const mondayEarly = shift({ starts_at: "2026-11-22T22:00:00Z", ends_at: "2026-11-23T06:00:00Z" });
  const ids = teamVisibleShifts(input([visible, draft, open, casual, nextWeek, sundayLate, mondayEarly])).map((s) => s.id);
  assert.deepEqual(ids, [visible.id, casual.id, sundayLate.id, mondayEarly.id]);
});

test("teamVisibleShifts: фильтр подразделения, включая «без подразделения»", () => {
  const kitchen = shift();
  const bar = shift({ department_id: "bar" });
  const none = shift({ department_id: null });
  assert.deepEqual(teamVisibleShifts(input([kitchen, bar, none], { department: "bar" })).map((s) => s.id), [bar.id]);
  assert.deepEqual(teamVisibleShifts(input([kitchen, bar, none], { department: "none" })).map((s) => s.id), [none.id]);
});

test("buildImageGroups: строки по подразделениям, дни недели, время по часам заведения", () => {
  const groups = buildImageGroups(input([
    shift({ starts_at: "2026-11-24T15:00:00Z", ends_at: "2026-11-24T21:00:00Z" }), // вт 18:00–00:00
    shift(), // пн 10:00–22:00
    shift({ user_id: "u2", department_id: "bar", role_id: "barman", template_id: "t1", color: "gray" }),
    shift({ user_id: null, payroll_employee_id: "p1", role_id: null }),
    shift({ user_id: "u3", department_id: null, role_id: "cook" }),
  ], { templateColors: { t1: "purple" } }));
  assert.deepEqual(groups.map((g) => g.name), ["Бар", "Кухня", "Без подразделения"]);
  const [bar, kitchen, none] = groups;
  assert.equal(bar.rows[0].days[0][0].color, "purple", "цвет смены — текущий цвет шаблона");
  assert.deepEqual(kitchen.rows.map((r) => [r.name, r.role]), [
    ["Анна Белова", "Повар"],
    ["Гоша", "Повар · разовый"],
  ]);
  const anna = kitchen.rows[0];
  assert.equal(anna.days.length, 7);
  assert.deepEqual(anna.days[0], [{ start: "10:00", end: "22:00", color: "orange" }]);
  assert.deepEqual(anna.days[1], [{ start: "18:00", end: "00:00", color: "orange" }]);
  assert.deepEqual(anna.days.slice(2), [[], [], [], [], []]);
  assert.equal(none.rows[0].name, "Вера Глебова");
});

test("buildImageGroups: две смены в день идут по времени, должность — по сменам в подразделении", () => {
  const [kitchen] = buildImageGroups(input([
    shift({ starts_at: "2026-11-23T15:00:00Z", ends_at: "2026-11-23T20:00:00Z", role_id: "chef" }),
    shift({ starts_at: "2026-11-23T06:00:00Z", ends_at: "2026-11-23T10:00:00Z" }),
  ]));
  assert.deepEqual(kitchen.rows[0].days[0].map((s) => s.start), ["09:00", "18:00"]);
  assert.equal(kitchen.rows[0].role, "Повар, Су-шеф");
});

const group = (name: string, rows: number): ImageGroup => ({
  id: name,
  name,
  rows: Array.from({ length: rows }, (_, i) => ({ key: `${name}${i}`, name: `${name}${i}`, role: "", days: [] })),
});

test("splitImageParts: маленькие подразделения собираются на одну картинку", () => {
  const parts = splitImageParts([group("Бар", 3), group("Зал", 4), group("Кухня", 5)], 14);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].label, "Бар, Зал, Кухня");
});

test("splitImageParts: подразделение не разрывается, пока помещается", () => {
  const parts = splitImageParts([group("Бар", 6), group("Зал", 7), group("Кухня", 9)], 14);
  assert.deepEqual(parts.map((p) => p.label), ["Бар, Зал", "Кухня"]);
  // Ровно 14 строк — ещё одна картинка: заголовок одного подразделения места не отнимает.
  assert.deepEqual(splitImageParts([group("Кухня", 14)], 14).map((p) => p.label), ["Кухня"]);
});

test("splitImageParts: большое подразделение режется на равные части", () => {
  const parts = splitImageParts([group("Бар", 2), group("Кухня", 30), group("Зал", 3)], 14);
  assert.deepEqual(parts.map((p) => p.label), ["Бар", "Кухня · 1 из 3", "Кухня · 2 из 3", "Кухня · 3 из 3", "Зал"]);
  assert.deepEqual(parts.slice(1, 4).map((p) => p.groups[0].rows.length), [10, 10, 10]);
  assert.deepEqual(splitImageParts([group("Кухня", 15)], 14).map((p) => p.groups[0].rows.length), [8, 7]);
  assert.equal(parts.flatMap((p) => p.groups.flatMap((g) => g.rows)).length, 35, "никто не потерялся");
});

test("splitImageParts: пустая неделя — одна пустая картинка", () => {
  assert.deepEqual(splitImageParts([]), [{ label: "", groups: [] }]);
});

test("weekPeriodLabel: месяц и год пишутся один раз, если совпадают", () => {
  assert.equal(weekPeriodLabel("2026-11-23"), "23–29 ноября 2026");
  assert.equal(weekPeriodLabel("2026-11-30"), "30 ноября – 6 декабря 2026");
  assert.equal(weekPeriodLabel("2025-12-29"), "29 декабря 2025 – 4 января 2026");
});

test("buildScheduleImage: шапка дней, имя файла и подпись", () => {
  const image = buildScheduleImage(input([shift(), shift({ user_id: "u2", department_id: "bar" })]), 1.5);
  assert.deepEqual(image.days.map((d) => `${d.weekday} ${d.day}`), ["Пн 23", "Вт 24", "Ср 25", "Чт 26", "Пт 27", "Сб 28", "Вс 29"]);
  assert.equal(image.parts.length, 2);
  assert.equal(scheduleImageFileName(image, 1), "Расписание 23–29 ноября 2026 · Кухня.png");
  assert.equal(scheduleImageFileName({ ...image, parts: image.parts.slice(0, 1) }, 0), "Расписание 23–29 ноября 2026.png");
  assert.equal(scheduleImageCaption({ venueName: "Бар <&>", period: image.period }), "<b>Расписание на 23–29 ноября 2026</b>\nБар &lt;&amp;&gt;");
});
