import test from "node:test";
import assert from "node:assert/strict";
import {
  breakdown,
  generatedLabel,
  statementFileName,
  statementWorkbook,
  workedHours,
  type StatementExportInput,
} from "./statement-export.ts";
import { columnName, sheetName, xlsxParts } from "../export/xlsx.ts";
import type { Accrual, Attendance, Component, PayEmployee } from "./types.ts";
import type { statementRows } from "./calculate.ts";

const component = (kind: string, amount: number | null, label = kind): Component => ({
  kind,
  label,
  amount,
  basis: "",
  source: "",
});

const accrual = (
  employee_id: string,
  business_date: string,
  components: Component[],
  salary: number,
  tips = 0,
  kind = "shift",
): Accrual => ({
  id: `${employee_id}-${business_date}-${kind}`,
  employee_id,
  business_date,
  period_id: "p",
  rule_version_id: null,
  components,
  salary,
  tips,
  status: "approved",
  issues: [],
  calculation_snapshot: { kind },
  updated_at: "",
});

const employee = (id: string, name: string, role_name: string): PayEmployee => ({
  id,
  account_id: "a",
  venue_id: "v",
  quickresto_id: null,
  name,
  local_user_id: null,
  role_name,
  model_id: null,
  hired_on: null,
  experience_offset_months: 0,
  active: true,
  opening_balance: 0,
  opening_confirmed: false,
});

const row = (e: PayEmployee, over: Partial<ReturnType<typeof baseRow>> = {}) => ({
  ...baseRow(e),
  ...over,
});
const baseRow = (e: PayEmployee) => ({
  employee: e,
  shifts: 2,
  earned: 5150.5,
  tips: 0,
  tipPaid: 0,
  tipRemaining: 0,
  opening: 0,
  paid: 3000,
  remaining: 2150.5,
  transferredIn: 0,
  transferredOut: 0,
  officialExpected: null as ReturnType<typeof statementRows>[number]["officialExpected"],
  bonuses: 500,
  deductions: 300,
  issues: 0,
});

const anna = employee("e1", "Анна Иванова", "Бармен");
const accruals = [
  accrual("e1", "2026-11-03", [component("base", 2000, "Выход"), component("percent", 1450.5), component("tips", 700)], 3450.5, 700),
  accrual("e1", "2026-11-04", [component("base", 1500, "Выход")], 1500),
  accrual("e1", "2026-11-20", [component("bonus", 500), component("deduction", -300, "Штраф")], 200, 0, "adjustment"),
  // Другой месяц и другой сотрудник в выгрузку не попадают.
  accrual("e1", "2026-10-30", [component("base", 9999)], 9999),
  accrual("e2", "2026-11-03", [component("base", 1000)], 1000),
];

const input = (over: Partial<StatementExportInput> = {}): StatementExportInput => ({
  venueName: "CHILLING",
  month: "2026-11-01",
  timezone: "Europe/Moscow",
  generatedAt: new Date("2026-11-19T11:05:00Z"),
  rows: [row(anna)],
  accruals,
  attendance: [],
  models: [],
  paidKnown: true,
  conditions: [],
  payments: [],
  ...over,
});

const texts = (cells: unknown[]) =>
  cells.map((c) => (c && typeof c === "object" && "v" in c ? (c as { v: unknown }).v : c));

test("breakdown adds up to the accrued salary", () => {
  const groups = breakdown(accruals.filter((a) => a.employee_id === "e1" && a.business_date >= "2026-11-01"));
  assert.equal(groups["Ставки за смены"], 3500);
  assert.equal(groups["Процент от продаж"], 1450.5);
  assert.equal(groups["Премии"], 500);
  assert.equal(groups["Удержания"], -300);
  assert.equal(groups["Прочее"], 0);
  const total = Object.values(groups).reduce((s, v) => s + v, 0);
  assert.equal(Math.round(total * 100), Math.round(5150.5 * 100));
});

test("breakdown puts unexplained salary into «Прочее»", () => {
  const groups = breakdown([accrual("e1", "2026-11-01", [component("base", 1000)], 1200)]);
  assert.equal(groups["Прочее"], 200);
});

test("worked hours count closed, counted marks of the month", () => {
  const mark = (status: Attendance["status"], starts: string, ends: string | null, date = "2026-11-03"): Attendance => ({
    id: starts,
    business_date: date,
    external_id: 1,
    employee_id: "e1",
    starts_at: starts,
    ends_at: ends,
    shift_id: null,
    role_name: "Бармен",
    status,
    issue: null,
    reviewed_by: null,
    review_reason: null,
    version: 1,
  });
  const hours = workedHours(
    [
      mark("confirmed", "2026-11-03T12:00:00Z", "2026-11-03T20:30:00Z"),
      mark("deviation", "2026-11-04T12:00:00Z", "2026-11-04T16:00:00Z", "2026-11-04"),
      mark("ignored", "2026-11-05T12:00:00Z", "2026-11-05T20:00:00Z", "2026-11-05"),
      mark("open", "2026-11-06T12:00:00Z", null, "2026-11-06"),
      mark("confirmed", "2026-10-31T12:00:00Z", "2026-10-31T20:00:00Z", "2026-10-31"),
    ],
    "e1",
    "2026-11-01",
  );
  assert.equal(hours, 12.5);
});

test("statement sheet: title, venue, header, data, totals with SUBTOTAL", () => {
  const [statement, shifts, payments] = statementWorkbook(input());
  assert.equal(statement.name, "Ведомость");
  assert.equal(texts(statement.rows[0])[0], "Зарплатная ведомость за ноябрь 2026");
  assert.equal(texts(statement.rows[1])[0], "CHILLING");
  assert.equal(texts(statement.rows[2])[0], "Сформировано 19.11.2026 в 14:05");
  const header = texts(statement.rows[4]);
  // Пустые группы (оклад, питание, …), часы без отметок, переносы и чаевые без сумм скрыты.
  assert.deepEqual(header, [
    "Сотрудник",
    "Должность",
    "Смены",
    "Ставки за смены",
    "Процент от продаж",
    "Премии",
    "Удержания",
    "Начислено",
    "Выплачено",
    "К выплате",
  ]);
  assert.deepEqual(texts(statement.rows[5]), [
    "Анна Иванова",
    "Бармен",
    2,
    3500,
    1450.5,
    500,
    -300,
    5150.5,
    3000,
    2150.5,
  ]);
  const total = statement.rows[6];
  assert.equal(texts(total)[0], "Итого: 1 сотрудник");
  assert.deepEqual(total[7], { v: 5150.5, s: "totalMoney", f: "SUBTOTAL(9,H6:H6)" });
  assert.deepEqual(statement.freeze, { rows: 5, cols: 1 });
  assert.equal(statement.autoFilter, "A5:J6");
  assert.equal(shifts.rows.length, 3 + 3 + 1);
  assert.equal(texts(shifts.rows[3])[0], "03.11.2026");
  assert.equal(texts(shifts.rows[5])[3], "Запись журнала");
  assert.equal(texts(shifts.rows[3])[6], "Выход 2\u00a0000; percent 1\u00a0450,5");
  assert.equal(payments.name, "Выплаты");
});

test("unknown paid amounts are dashes, not zeros, and explained", () => {
  const [statement] = statementWorkbook(
    input({ paidKnown: false, conditions: ["должность «Бармен»"] }),
  );
  assert.match(String(texts(statement.rows[2])[0]), /Отбор: должность «Бармен»$/);
  const data = texts(statement.rows[5]);
  assert.equal(data.at(-1), "—");
  assert.equal(data.at(-2), "—");
  assert.equal(texts(statement.rows[6]).at(-1), "—");
  assert.ok(
    statement.rows.some((r) => String(texts(r)[0]).startsWith("Выплачено и К выплате появятся")),
  );
});

test("ожидаемая официальная часть — отдельный столбец, неизвестная сумма текстом", () => {
  const boris = employee("e2", "Борис Петров", "Кассир");
  const [statement] = statementWorkbook(
    input({
      rows: [
        row(anna, { remaining: -77849.5, officialExpected: { amount: 80000, kind: "full", days_paid: null, days_in_month: 30 } }),
        row(boris, { officialExpected: { amount: null, kind: "final", days_paid: null, days_in_month: 30 } }),
      ],
    }),
  );
  const header = texts(statement.rows[4]);
  const col = header.indexOf("Официальная часть (ожидается)");
  assert.ok(col > header.indexOf("Выплачено") && col < header.indexOf("К выплате"));
  assert.equal(texts(statement.rows[5])[col], 80000);
  assert.deepEqual(statement.rows[6][col], { v: "уточняется", s: "muted" });
  // Неизвестная сумма в итог не входит — как и в «К выплате».
  assert.equal((statement.rows[7][col] as { v: number }).v, 80000);
  assert.ok(statement.rows.some((r) => String(texts(r)[0]).includes("− официальная часть")));
  // Без официально оформленных столбца нет.
  const [plain] = statementWorkbook(input());
  assert.equal(texts(plain.rows[4]).includes("Официальная часть (ожидается)"), false);
});

test("xlsx parts: inline strings are escaped and never formulas", () => {
  const parts = xlsxParts([
    { name: "Лист: 1/2", rows: [["=HYPERLINK(\"x\")", "<b>&"], [1.5, { v: 3, s: "money", f: "SUM(A2:A2)" }]] },
  ]);
  const sheet = parts["xl/worksheets/sheet1.xml"];
  assert.ok(sheet.includes('t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;x&quot;)</t>'));
  assert.ok(sheet.includes("&lt;b&gt;&amp;"));
  assert.ok(sheet.includes('<c r="B2" s="5"><f>SUM(A2:A2)</f><v>3</v></c>'));
  assert.ok(parts["xl/workbook.xml"].includes('name="Лист  1 2"'));
});

test("helpers", () => {
  assert.equal(columnName(0), "A");
  assert.equal(columnName(25), "Z");
  assert.equal(columnName(26), "AA");
  assert.equal(sheetName("x".repeat(40)).length, 31);
  assert.equal(statementFileName("2026-11-01", "Бар/Кухня"), "Ведомость 2026-11 Бар Кухня.xlsx");
  assert.equal(statementFileName("2026-11-01", 'Ресторан "Тест"'), "Ведомость 2026-11 Ресторан Тест.xlsx");
  assert.equal(generatedLabel(new Date("2026-01-02T21:30:00Z"), "Europe/Moscow"), "03.01.2026 в 00:30");
});
