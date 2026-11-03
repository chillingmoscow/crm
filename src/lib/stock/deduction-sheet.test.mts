import { test } from "node:test";
import assert from "node:assert/strict";
import {
  duplicateEmployeeCounts,
  matchSheetNames,
  normalizePersonName,
  parseSheetPaste,
  sheerlySideFor,
} from "./deduction-sheet.ts";

test("вставка из Sheets: табуляция, запятая как десятичная, пробел как разделитель тысяч", () => {
  const r = parseSheetPaste("Иванов Иван\t1 500,50\nПетрова Анна\t300\n");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(
    r.entries.map((e) => [e.name, e.amount]),
    [["Иванов Иван", 1500.5], ["Петрова Анна", 300]],
  );
});

test("точка с запятой, точка как десятичная, неразрывные пробелы, знак рубля", () => {
  const r = parseSheetPaste("Иванов Иван;1 500.5 ₽\nПетрова Анна;1 000,00");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.entries.map((e) => e.amount), [1500.5, 1000]);
});

test("строка заголовка пропускается, пустые строки пропускаются", () => {
  const r = parseSheetPaste("Сотрудник\tНедостача\n\nИванов Иван\t100\n   \n");
  assert.equal(r.headerText, "Сотрудник\tНедостача");
  assert.deepEqual(r.errors, []);
  assert.equal(r.entries.length, 1);
});

test("строку, которую нельзя разобрать, называют с номером и текстом, а не теряют", () => {
  const r = parseSheetPaste("Иванов Иван\t100\nПетрова Анна\tмного\nбез разделителя\nСидоров\t12,3,4");
  assert.equal(r.entries.length, 1);
  assert.deepEqual(
    r.errors.map((e) => [e.line, e.text]),
    [[2, "Петрова Анна\tмного"], [3, "без разделителя"], [4, "Сидоров\t12,3,4"]],
  );
});

test("пустая ячейка суммы - неизвестная сумма, а не ноль", () => {
  const r = parseSheetPaste("Иванов Иван\t\nПетрова Анна\t0");
  assert.equal(r.entries[0].amount, null);
  assert.equal(r.entries[1].amount, 0);
});

test("минус может быть настоящим или типографским", () => {
  const r = parseSheetPaste("А Б\t-100\nВ Г\t−100,5");
  assert.deepEqual(r.entries.map((e) => e.amount), [-100, -100.5]);
});

test("нормализация имени: пробелы, регистр, ё и е", () => {
  assert.equal(normalizePersonName("  Фёдоров   ПЁТР "), normalizePersonName("федоров петр"));
  assert.notEqual(normalizePersonName("Иванов Иван"), normalizePersonName("Иван Иванов"));
});

const DIRECTORY = [
  { id: "e1", name: "Иванов Иван" },
  { id: "e2", name: "Фёдоров Пётр" },
  { id: "e3", name: "Сидоров Олег" },
  { id: "e4", name: "сидоров  олег" },
];

test("точное совпадение по нормализованному имени", () => {
  const m = matchSheetNames(
    [{ line: 1, name: "ФЕДОРОВ ПЕТР", amount: 10 }],
    DIRECTORY,
  );
  assert.deepEqual(m.matched, [{ line: 1, name: "ФЕДОРОВ ПЕТР", amount: 10, employeeId: "e2" }]);
  assert.deepEqual(m.unmatched, []);
});

test("имя, подходящее двум сотрудникам, не выбирается, а уходит в неоднозначные", () => {
  const m = matchSheetNames([{ line: 4, name: "Сидоров Олег", amount: 5 }], DIRECTORY);
  assert.deepEqual(m.matched, []);
  assert.equal(m.unmatched.length, 1);
  assert.equal(m.unmatched[0].reason, "ambiguous");
  assert.equal(m.unmatched[0].amount, 5);
  assert.deepEqual(m.unmatched[0].candidates, ["Сидоров Олег", "сидоров  олег"]);
});

test("имя, которого нет, уходит в ненайденные и не угадывается", () => {
  const m = matchSheetNames([{ line: 2, name: "Иванов Иваан", amount: 7 }], DIRECTORY);
  assert.deepEqual(m.matched, []);
  assert.equal(m.unmatched[0].reason, "not_found");
});

test("расчёт готов: сотрудник без строки удержания - это ноль, а не неизвестное", () => {
  const side = sheerlySideFor({
    state: "ready",
    capturedAt: "2026-11-03T09:00:00Z",
    lines: [{ employeeId: "e1", amount: 300 }],
    knownEmployeeIds: ["e1", "e2"],
  });
  assert.equal(side.capturedAt, "2026-11-03T09:00:00Z");
  assert.deepEqual(side.entries, [
    { employeeId: "e1", amount: 300 },
    { employeeId: "e2", amount: 0 },
  ]);
});

test("месяц не посчитан до конца: суммы неизвестны, а не нулевые", () => {
  const side = sheerlySideFor({
    state: "incomplete",
    capturedAt: "2026-11-03T09:00:00Z",
    lines: [],
    knownEmployeeIds: ["e1"],
  });
  assert.deepEqual(side.entries, [{ employeeId: "e1", amount: null }]);
});

test("правила выключены: по расчёту удерживать нечего - ноль", () => {
  const side = sheerlySideFor({
    state: "disabled",
    capturedAt: "2026-11-03T09:00:00Z",
    lines: [],
    knownEmployeeIds: ["e1"],
  });
  assert.deepEqual(side.entries, [{ employeeId: "e1", amount: 0 }]);
});

test("сумма с одним разделителем и тремя знаками после него неоднозначна: 1,500 - ошибка, а не 1,5", () => {
  for (const cell of ["1,500", "1.500", "12,345", "999.000", "-1,500", "-1.500"]) {
    const r = parseSheetPaste(`Иванов Иван\t${cell}`);
    assert.equal(r.entries.length, 0, cell);
    assert.equal(r.errors.length, 1, cell);
    assert.match(r.errors[0].reason, /неоднозначн/i);
  }
});

test("неоднозначность не мешает честным суммам", () => {
  const r = parseSheetPaste(
    ["А\t0,500", "Б\t1,50", "В\t1.5", "Г\t1 500", "Д\t1500,5", "Е\t12345,678", "Ж\t1,5000", "З\t1500,500"].join("\n"),
  );
  assert.deepEqual(r.errors, []);
  // «1500,500» - четыре знака до разделителя, значит это десятичная запись (1500,5), а не тысячи.
  assert.deepEqual(r.entries.map((e) => e.amount), [0.5, 1.5, 1.5, 1500, 1500.5, 12345.678, 1.5, 1500.5]);
});

test("неоднозначная сумма в первой строке - ошибка, а не заголовок", () => {
  const r = parseSheetPaste("Иванов Иван\t1,500\nПетрова Анна\t300");
  assert.equal(r.headerText, null);
  assert.equal(r.errors.length, 1);
});

test("incomplete: строки удержания не отдаются даже если они переданы", () => {
  const side = sheerlySideFor({
    state: "incomplete",
    capturedAt: "2026-11-03T09:00:00Z",
    lines: [{ employeeId: "e1", amount: 300 }, { employeeId: "e9", amount: 50 }],
    knownEmployeeIds: ["e1"],
  });
  assert.deepEqual(side.entries, [{ employeeId: "e1", amount: null }]);
});

test("ready: человек со строкой удержания, которого нет среди известных, не пропадает", () => {
  const side = sheerlySideFor({
    state: "ready",
    capturedAt: "2026-11-03T09:00:00Z",
    lines: [{ employeeId: "e1", amount: 300 }, { employeeId: "e9", amount: 50 }],
    knownEmployeeIds: ["e1", "e2"],
  });
  assert.deepEqual(
    side.entries.map((e) => [e.employeeId, e.amount]).sort(),
    [["e1", 300], ["e2", 0], ["e9", 50]],
  );
});

test("повтор сотрудника во вставке считается: показываем, сколько строк слилось", () => {
  const counts = duplicateEmployeeCounts([
    { line: 1, name: "А", amount: 1, employeeId: "e1" },
    { line: 2, name: "А", amount: 1, employeeId: "e1" },
    { line: 3, name: "Б", amount: 1, employeeId: "e2" },
  ]);
  assert.deepEqual([...counts.entries()], [["e1", 2]]);
});
