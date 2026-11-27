import test from "node:test";
import assert from "node:assert/strict";

import {
  LAYOUT,
  MAX_SLOTS_PER_CELL,
  buildImageRows,
  buildScheduleImage,
  labelLines,
  rowHeight,
  scheduleImageCaption,
  scheduleImageFileName,
  slotName,
  slotTime,
  splitImageParts,
  teamVisibleShifts,
  weekPeriodLabel,
  type ImageRow,
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
  template_id: "cook",
  title: "Повар",
  color: "gray",
  ...over,
});
const input = (shifts: ImageShift[], over: Partial<ScheduleImageInput> = {}): ScheduleImageInput => ({
  venueName: "Кафе",
  timezone: "Europe/Moscow",
  week,
  department: null,
  shifts,
  people: [
    { key: "u1", name: "Анна Белова" },
    { key: "u2", name: "Борис Волков" },
    { key: "u3", name: "Вера Глебова" },
    { key: "payroll:p1", name: "Гоша" },
  ],
  templates: [
    { id: "cook", name: "Повар", subtitle: "", color: "orange", department_id: "kitchen", archived: false, start_time: "09:00:00", end_time: "21:00:00", variants: [] },
    { id: "bar-day", name: "Бармен", subtitle: "день", color: "blue", department_id: "bar", archived: false, start_time: "12:00:00", end_time: "20:00:00", variants: [] },
    { id: "bar-night", name: "Бармен", subtitle: "вечер", color: "purple", department_id: "bar", archived: false, start_time: "18:00:00", end_time: "03:00:00", variants: null },
    { id: "old", name: "Старый", subtitle: "", color: "red", department_id: "kitchen", archived: true, start_time: "08:00:00", end_time: "16:00:00", variants: [] },
    { id: "idle", name: "Без смен", subtitle: "", color: "green", department_id: null, archived: false, start_time: "07:00:00", end_time: "15:00:00", variants: [] },
  ],
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

const orderShifts = () => [
  shift(),
  shift({ user_id: "u2", template_id: "bar-night", department_id: "bar" }),
  shift({ user_id: "u3", template_id: "bar-day", department_id: "bar" }),
  shift({ user_id: "u2", template_id: "old", title: "Старый", color: "red" }),
  shift({ user_id: "u3", template_id: null, title: "Инвентаризация", color: "yellow" }),
];

test("buildImageRows: по умолчанию строки идут по времени начала шаблона, «Другие смены» — последней", () => {
  const rows = buildImageRows(input(orderShifts()));
  assert.deepEqual(rows.map((r) => r.key), ["cook", "bar-day", "bar-night", "other"]);
});

test("buildImageRows: строки — шаблоны со сменами в порядке вида «По шаблонам», затем «Другие смены»", () => {
  const rows = buildImageRows(input(orderShifts(), { sort: "name" }));
  assert.deepEqual(rows.map((r) => [r.title.join(" "), r.subtitle.join(" ")]), [
    ["Бармен", "вечер"],
    ["Бармен", "день"],
    ["Повар", ""],
    ["Другие смены", ""],
  ]);
  const other = rows[3];
  assert.equal(other.color, null);
  assert.deepEqual(other.days[0].map((s) => [s.title, s.name.join(" "), s.color]), [
    ["Старый", "Борис Волков", "red"],
    ["Инвентаризация", "Вера Глебова", "yellow"],
  ]);
});

test("buildImageRows: ячейка — сотрудники и время по часам заведения, цвет — цвет шаблона", () => {
  const [cook] = buildImageRows(input([
    shift({ user_id: "u3", starts_at: "2026-11-24T06:30:00Z", ends_at: "2026-11-24T19:00:00Z" }), // вт 09:30–22:00
    shift({ starts_at: "2026-11-24T06:30:00Z", ends_at: "2026-11-24T19:00:00Z" }),
    shift({ user_id: null, payroll_employee_id: "p1", starts_at: "2026-11-24T15:00:00Z", ends_at: "2026-11-24T21:00:00Z" }),
  ]));
  assert.equal(cook.days.length, 7);
  assert.deepEqual(cook.days[0], []);
  assert.deepEqual(cook.days[1], [
    { color: "orange", title: null, name: ["Анна Белова"], time: ["09:30–22"] },
    { color: "orange", title: null, name: ["Вера Глебова"], time: ["09:30–22"] },
    { color: "orange", title: null, name: ["Гоша"], time: ["18–0"] },
  ]);
});

test("buildImageRows: фильтр подразделения — шаблоны и смены этого подразделения", () => {
  const rows = buildImageRows(input([
    shift(),
    shift({ user_id: "u2", template_id: "bar-day", department_id: "bar" }),
    shift({ user_id: "u3", template_id: null, department_id: "bar" }),
  ], { department: "bar" }));
  assert.deepEqual(rows.map((r) => r.key), ["bar-day", "other"]);
});

test("slotTime, slotName, labelLines: текст раскладывается под узкий столбец", () => {
  assert.deepEqual(slotTime("10:00", "22:00"), ["10–22"]);
  assert.deepEqual(slotTime("09:00", "22:00"), ["9–22"]);
  assert.deepEqual(slotTime("10:30", "22:00"), ["10:30–22"]);
  assert.deepEqual(slotTime("10:30", "22:30"), ["10:30–22:30"]);
  assert.deepEqual(slotTime("10:30", "22:30", 120), ["10:30–", "22:30"]);
  assert.deepEqual(slotTime("10:30", "22:30"), ["10:30–22:30"]);
  assert.deepEqual(slotTime("10:30", "22:30", 120), ["10:30–", "22:30"]);
  assert.deepEqual(slotName("Анна Белова"), ["Анна Белова"]);
  assert.deepEqual(slotName("Григорий Константинопольский"), ["Григорий", "Константинопольский"]);
  assert.deepEqual(slotName("Анна Белова", 100), ["Анна", "Белова"]);
  assert.deepEqual(slotName("  "), ["Сотрудник"]);
  assert.deepEqual(labelLines("Бар"), ["Бар"]);
  assert.deepEqual(labelLines("Старший повар горячего цеха"), ["Старший", "повар горячего цеха"]);
  assert.deepEqual(labelLines(""), []);
  assert.deepEqual(labelLines("холодный цех", 200, 24), ["холодный цех"]);
  assert.deepEqual(labelLines("холодный цех", 140, 24), ["холодный", "цех"]);
});

const row = (key: string, slotsPerDay: number): ImageRow => ({
  key,
  title: [key],
  subtitle: [],
  color: "blue",
  days: Array.from({ length: 7 }, () =>
    Array.from({ length: slotsPerDay }, () => ({ color: "blue", title: null, name: ["Анна", "Белова"], time: ["10–22"] })),
  ),
});

test("splitImageParts: делит по высоте, строку не режет", () => {
  const small = row("a", 1);
  const big = row("b", 3);
  const h = rowHeight(small);
  assert.ok(rowHeight(big) > h * 2, "три сотрудника в день — строка выше");
  assert.deepEqual(splitImageParts([small, small, small], h * 3).map((p) => p.rows.length), [3]);
  assert.deepEqual(splitImageParts([small, small, small], h * 2).map((p) => p.rows.length), [2, 1]);
  // Строка выше предела — на отдельной картинке целиком.
  assert.deepEqual(splitImageParts([small, big, small], h * 2).map((p) => p.rows.map((r) => r.key)), [["a"], ["b"], ["a"]]);
  assert.deepEqual(splitImageParts([]), [{ rows: [] }]);
});

test("buildImageRows: много людей в один день — «+N ещё», высота строки ограничена", () => {
  const crowd = Array.from({ length: 40 }, (_, i) =>
    shift({ user_id: `x${i}`, template_id: null, title: "Банкет на всю ночь с фуршетом" }),
  );
  const [other] = buildImageRows(input(crowd));
  const monday = other.days[0];
  assert.equal(monday.length, MAX_SLOTS_PER_CELL);
  assert.deepEqual(monday[MAX_SLOTS_PER_CELL - 1].name, [`+${40 - (MAX_SLOTS_PER_CELL - 1)} ещё`]);
  assert.ok(rowHeight(other) <= LAYOUT.maxBody, "строка помещается на одну картинку");
});

test("weekPeriodLabel: месяц и год пишутся один раз, если совпадают", () => {
  assert.equal(weekPeriodLabel("2026-11-23"), "23–29 ноября 2026");
  assert.equal(weekPeriodLabel("2026-11-30"), "30 ноября – 6 декабря 2026");
  assert.equal(weekPeriodLabel("2025-12-29"), "29 декабря 2025 – 4 января 2026");
});

test("buildScheduleImage: шапка дней, имя файла и подпись", () => {
  const image = buildScheduleImage(input([shift(), shift({ user_id: "u2", template_id: "bar-day", department_id: "bar" })]), 1);
  assert.deepEqual(image.days.map((d) => `${d.weekday} ${d.day}`), ["Пн 23", "Вт 24", "Ср 25", "Чт 26", "Пт 27", "Сб 28", "Вс 29"]);
  assert.equal(image.parts.length, 2);
  assert.equal(scheduleImageFileName(image, 1), "Расписание 23–29 ноября 2026 · 2 из 2.png");
  assert.equal(scheduleImageFileName({ ...image, parts: image.parts.slice(0, 1) }, 0), "Расписание 23–29 ноября 2026.png");
  assert.equal(scheduleImageCaption({ venueName: "Бар <&>", period: image.period }), "<b>Расписание на 23–29 ноября 2026</b>\nБар &lt;&amp;&gt;");
});
