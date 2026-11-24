import test from "node:test";
import assert from "node:assert/strict";
import {
  changeOfficialSalarySchema,
  contractDocumentName,
  contractLabel,
  employOfficiallySchema,
  endOfficialEmploymentSchema,
  isIsoDate,
  officialSalaryOn,
  salaryDocumentName,
  terminationOfficialEndSchema,
  updateOfficialEmploymentSchema,
} from "./official-employment.ts";
import { decodeStaffDocumentName, staffDocumentPath, staffDocumentProblem } from "./staff-document-name.ts";

const EMPLOYEE = "7f9c1c8e-6a3b-4f6e-9d1f-2b8a4c5d6e7f";

const firstIssue = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? null : result.error!.issues[0].message;

test("дата — только существующий календарный день", () => {
  assert.equal(isIsoDate("2026-11-03"), true);
  assert.equal(isIsoDate("2028-02-29"), true);
  assert.equal(isIsoDate("2026-02-29"), false);
  assert.equal(isIsoDate("2026-11-31"), false);
  assert.equal(isIsoDate("03.11.2026"), false);
  assert.equal(isIsoDate(""), false);
});

test("оформление: проверка до команды базы", () => {
  const ok = employOfficiallySchema.parse({
    employee_id: EMPLOYEE,
    starts_on: "2026-11-03",
    position: "  Менеджер по работе с клиентами ",
    gross: 80000,
    contract_number: "17",
    contract_date: "2026-11-03",
  });
  assert.equal(ok.position, "Менеджер по работе с клиентами");
  assert.equal("contract_path" in ok, false, "необязательное поле не появляется ключом");

  const base = { employee_id: EMPLOYEE, starts_on: "2026-11-03", position: "Менеджер", gross: 80000 };
  assert.equal(firstIssue(employOfficiallySchema.safeParse({ ...base, employee_id: "1" })), "Сотрудник не найден в зарплате заведения");
  assert.equal(firstIssue(employOfficiallySchema.safeParse({ ...base, starts_on: "2026-02-30" })), "Укажите дату оформления");
  assert.equal(firstIssue(employOfficiallySchema.safeParse({ ...base, position: "   " })), "Укажите должность по договору");
  assert.equal(firstIssue(employOfficiallySchema.safeParse({ ...base, gross: 0 })), "Укажите оклад по договору больше нуля");
  assert.equal(firstIssue(employOfficiallySchema.safeParse({ ...base, gross: null })), "Укажите оклад по договору больше нуля");
  assert.equal(firstIssue(employOfficiallySchema.safeParse({ ...base, gross: 1.005 })), "Не больше двух знаков после запятой");
  assert.equal(firstIssue(employOfficiallySchema.safeParse({ ...base, contract_date: "2026-13-01" })), "Проверьте дату договора");
  assert.equal(employOfficiallySchema.safeParse({ ...base, gross: 74666.67, contract_date: null }).success, true);
});

test("новый оклад — только с первого числа месяца", () => {
  const base = { employment_id: EMPLOYEE, gross: 90000 };
  assert.equal(changeOfficialSalarySchema.safeParse({ ...base, valid_from: "2026-12-01" }).success, true);
  assert.equal(firstIssue(changeOfficialSalarySchema.safeParse({ ...base, valid_from: "2026-12-05" })), "Оклад меняется с первого числа месяца");
  assert.equal(firstIssue(changeOfficialSalarySchema.safeParse({ ...base, valid_from: "" })), "Укажите, с какого месяца действует оклад");
});

test("исправление данных передаёт только изменённые поля, пустое — очищает", () => {
  const parsed = updateOfficialEmploymentSchema.parse({ employment_id: EMPLOYEE, contract_number: null });
  assert.deepEqual(parsed, { employment_id: EMPLOYEE, contract_number: null });
  assert.equal(firstIssue(endOfficialEmploymentSchema.safeParse({ employment_id: EMPLOYEE, ends_on: "" })), "Укажите дату официального увольнения");
});

test("название файла договора и допсоглашения", () => {
  assert.equal(contractDocumentName("17", "2026-11-03"), "Трудовой договор № 17 от 03.11.2026");
  assert.equal(contractDocumentName(" 17 ", null), "Трудовой договор № 17");
  assert.equal(contractDocumentName("", "2026-11-03"), "Трудовой договор");
  assert.equal(contractDocumentName(null, null), "Трудовой договор");
  assert.equal(salaryDocumentName("2026-12-01"), "Допсоглашение от 01.12.2026");
  assert.equal(contractLabel("17", "2026-11-03"), "№ 17 от 03.11.2026");
  assert.equal(contractLabel(null, "2026-11-03"), "от 03.11.2026");
  assert.equal(contractLabel(null, null), null);
  // Самое длинное название укладывается в ограничение «Документов».
  assert.equal(staffDocumentProblem({ type: "application/pdf", size: 1 }, contractDocumentName("x".repeat(50), "2026-11-03")), null);
});

test("оклад на дату: текущий и следующий", () => {
  const salaries = [
    { valid_from: "2026-11-01", gross: 80000 },
    { valid_from: "2027-01-01", gross: 90000 },
  ];
  assert.deepEqual(officialSalaryOn(salaries, "2026-11-24"), { current: salaries[0], next: salaries[1] });
  assert.deepEqual(officialSalaryOn(salaries, "2027-01-15"), { current: salaries[1], next: null });
  // Оформлен с будущего месяца: первый оклад и есть текущий.
  assert.deepEqual(officialSalaryOn(salaries, "2026-10-10"), { current: salaries[0], next: salaries[1] });
  assert.deepEqual(officialSalaryOn([], "2026-11-24"), { current: null, next: null });
});

test("файл в «Документах»: формат, размер, название, путь", () => {
  assert.equal(staffDocumentProblem({ type: "application/pdf", size: 10 * 1024 * 1024 }, "Договор"), null);
  assert.equal(
    staffDocumentProblem({ type: "application/msword", size: 1 }, "Договор"),
    "Выберите JPEG, PNG, WebP, HEIC или PDF размером до 10 МБ",
  );
  assert.equal(
    staffDocumentProblem({ type: "image/png", size: 10 * 1024 * 1024 + 1 }, "Договор"),
    "Выберите JPEG, PNG, WebP, HEIC или PDF размером до 10 МБ",
  );
  assert.equal(staffDocumentProblem({ type: "image/png", size: 1 }, "  "), "Укажите название документа до 100 символов");
  assert.equal(staffDocumentProblem({ type: "image/png", size: 1 }, "x".repeat(101)), "Укажите название документа до 100 символов");

  const path = staffDocumentPath({
    venueId: "venue", userId: "user", name: " Трудовой договор № 17 ", type: "application/pdf", timestamp: 1700000000000, nonce: "n",
  });
  const match = /^venue\/user\/passport\/1700000000000__(hex-[0-9a-f]+)__n\.pdf$/.exec(path);
  assert.ok(match, path);
  assert.equal(decodeStaffDocumentName(match[1]), "Трудовой договор № 17");
});

test("увольнение: дата официального увольнения необязательна, но если есть, то настоящая", () => {
  assert.equal(terminationOfficialEndSchema.parse(undefined), null);
  assert.equal(terminationOfficialEndSchema.parse(null), null);
  assert.equal(terminationOfficialEndSchema.parse("  "), null);
  assert.equal(terminationOfficialEndSchema.parse(" 2026-11-24 "), "2026-11-24");
  assert.equal(firstIssue(terminationOfficialEndSchema.safeParse("2026-02-30")), "Проверьте дату официального увольнения");
  assert.equal(firstIssue(terminationOfficialEndSchema.safeParse("24.11.2026")), "Проверьте дату официального увольнения");
});
