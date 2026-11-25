// Export of the payroll statement («Ведомость») to a styled XLSX workbook.
// Pure: builds the sheets from the same rows the screen shows; the client
// zips and downloads them (src/lib/export/xlsx.ts).
import type { statementRows } from "./calculate.ts";
import { accrualRole, isShiftAccrual } from "./accrual-view.ts";
import type { PaymentJournalRow } from "./payment-journal.ts";
import type { Accrual, Attendance, PayModel } from "./types.ts";
import {
  cellRef,
  columnName,
  type XlsxCell,
  type XlsxSheet,
  type XlsxStyle,
} from "../export/xlsx.ts";

type StatementRow = ReturnType<typeof statementRows>[number];

/** Columns of the accrual breakdown, in display order. */
export const BREAKDOWN_GROUPS = [
  "Ставки за смены",
  "Оклад",
  "Процент от продаж",
  "Допродажи",
  "Надбавки",
  "Питание",
  "Премии",
  "Прочее",
  "Удержания",
] as const;
type Group = (typeof BREAKDOWN_GROUPS)[number];

const GROUP_BY_KIND: Record<string, Group> = {
  base: "Ставки за смены",
  monthly: "Оклад",
  percent: "Процент от продаж",
  extra: "Допродажи",
  experience: "Надбавки",
  knowledge: "Надбавки",
  allowance: "Надбавки",
  food: "Питание",
  bonus: "Премии",
  cleaner: "Премии",
};

const cents = (n: number) => Math.round(n * 100);
const fromCents = (n: number) => n / 100;

/**
 * Accruals of one employee split into breakdown groups. Negative amounts go
 * to «Удержания», tips are separate; whatever the components do not explain
 * goes to «Прочее», so the groups always add up to «Начислено».
 */
export function breakdown(accruals: Accrual[]): Record<Group, number> {
  const out = Object.fromEntries(BREAKDOWN_GROUPS.map((g) => [g, 0])) as Record<
    Group,
    number
  >;
  let explained = 0;
  let earned = 0;
  for (const a of accruals) {
    earned += cents(Number(a.salary));
    for (const c of a.components) {
      if (c.kind === "tips" || c.amount === null) continue;
      const amount = cents(Number(c.amount));
      if (!amount) continue;
      const group: Group =
        amount < 0
          ? "Удержания"
          : (GROUP_BY_KIND[c.kind] ?? (c.label === "Выход" ? "Ставки за смены" : "Прочее"));
      out[group] += amount;
      explained += amount;
    }
  }
  out["Прочее"] += earned - explained;
  for (const g of BREAKDOWN_GROUPS) out[g] = fromCents(out[g]);
  return out;
}

const WORKED: Attendance["status"][] = ["confirmed", "deviation", "unplanned"];

/** Hours by closed attendance marks that count as work (not ignored or missing). */
export function workedHours(attendance: Attendance[], employeeId: string, month: string): number {
  const prefix = month.slice(0, 7);
  let ms = 0;
  for (const a of attendance) {
    if (a.employee_id !== employeeId || !a.ends_at || !WORKED.includes(a.status)) continue;
    if (!a.business_date.startsWith(prefix)) continue;
    const span = Date.parse(a.ends_at) - Date.parse(a.starts_at);
    if (Number.isFinite(span) && span > 0) ms += span;
  }
  return Math.round(ms / 360000) / 10;
}

const ddmmyyyy = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
};

export function generatedLabel(at: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day}.${parts.month}.${parts.year} в ${parts.hour}:${parts.minute}`;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10,
    m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

type Column = {
  title: string;
  width: number;
  style: XlsxStyle;
  total?: "sum" | "none";
  /** Zero is left blank: in the breakdown «nothing of this kind» reads faster. */
  blankZero?: boolean;
  value: (row: StatementRow, extra: RowExtra) => number | string | null;
};
type RowExtra = { groups: Record<Group, number>; hours: number };

export type StatementExportInput = {
  venueName: string | null;
  /** First day of the month, YYYY-MM-01. */
  month: string;
  timezone: string;
  generatedAt: Date;
  /** Rows exactly as visible in the statement (search and filters applied). */
  rows: StatementRow[];
  /** All accruals; the export takes the month and the visible employees. */
  accruals: Accrual[];
  attendance: Attendance[];
  models: PayModel[];
  roles?: { id: string; name: string }[];
  /** False while earlier payments of the month are not reconciled. */
  paidKnown: boolean;
  /** Human-readable active conditions, e.g. «должность „Бармен“». */
  conditions: string[];
  payments: PaymentJournalRow[];
};

const fileName = (kind: string, month: string, venueName: string | null) => {
  const venue = (venueName ?? "")
    .replace(/[\\/:*?"<>|«»]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${kind} ${month.slice(0, 7)}${venue ? ` ${venue}` : ""}.xlsx`;
};
export const statementFileName = (month: string, venueName: string | null) =>
  fileName("Ведомость", month, venueName);
export const paymentsFileName = (month: string, venueName: string | null) =>
  fileName("Выплаты", month, venueName);

export function statementWorkbook(input: StatementExportInput): XlsxSheet[] {
  const year = input.month.slice(0, 4);
  const monthNominative = new Date(`${input.month.slice(0, 7)}-15T12:00:00Z`)
    .toLocaleDateString("ru-RU", { month: "long", timeZone: "UTC" });
  const until = (() => {
    const d = new Date(`${input.month.slice(0, 7)}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const inMonth = (a: Accrual) => a.business_date >= input.month && a.business_date < until;
  // Бумажная ведомость читается по алфавиту, а не по сумме.
  const sorted = [...input.rows].sort((a, b) =>
    a.employee.name.localeCompare(b.employee.name, "ru"),
  );
  input = { ...input, rows: sorted };
  const ids = new Set(input.rows.map((r) => r.employee.id));
  const monthAccruals = input.accruals.filter((a) => ids.has(a.employee_id) && inMonth(a));

  const extras = new Map<string, RowExtra>(
    input.rows.map((r) => [
      r.employee.id,
      {
        groups: breakdown(monthAccruals.filter((a) => a.employee_id === r.employee.id)),
        hours: workedHours(input.attendance, r.employee.id, input.month),
      },
    ]),
  );
  const any = (pick: (r: StatementRow, e: RowExtra) => number) =>
    input.rows.some((r) => pick(r, extras.get(r.employee.id)!) !== 0);

  const known = input.paidKnown;
  const columns: Column[] = [
    { title: "Сотрудник", width: 30, style: "text", total: "none", value: (r) => r.employee.name },
    { title: "Должность", width: 22, style: "text", total: "none", value: (r) => r.employee.role_name || "—" },
    { title: "Смены", width: 9, style: "int", value: (r) => r.shifts },
  ];
  if (any((_, e) => e.hours))
    columns.push({ title: "Часы по отметкам", width: 11, style: "hours", value: (_, e) => e.hours });
  for (const g of BREAKDOWN_GROUPS) {
    if (any((_, e) => e.groups[g]))
      columns.push({ title: g, width: 14, style: "money", blankZero: true, value: (_, e) => e.groups[g] });
  }
  columns.push({ title: "Начислено", width: 15, style: "money", value: (r) => r.earned });
  if (any((r) => r.opening))
    columns.push({ title: "Перенос с прошлых месяцев", width: 15, style: "money", value: (r) => r.opening });
  if (any((r) => r.transferredOut))
    columns.push({ title: "Перенесено далее", width: 14, style: "money", value: (r) => r.transferredOut });
  columns.push({ title: "Выплачено", width: 15, style: "money", value: (r) => (known ? r.paid : null) });
  // Ещё не проведённая официальная часть: уже вычтена из «К выплате».
  // Сумма месяца увольнения неизвестна — текст, в итог не входит.
  const official = input.rows.some((r) => r.officialExpected);
  if (official)
    columns.push({
      title: "Официальная часть (ожидается)",
      width: 16,
      style: "money",
      blankZero: true,
      value: (r) =>
        !r.officialExpected ? 0 : r.officialExpected.amount ?? "уточняется",
    });
  columns.push({ title: "К выплате", width: 15, style: "money", value: (r) => (known ? r.remaining : null) });
  if (any((r) => r.tips || r.tipPaid)) {
    columns.push(
      { title: "Чаевые", width: 13, style: "money", value: (r) => r.tips },
      { title: "Чаевые выплачено", width: 13, style: "money", value: (r) => r.tipPaid },
      { title: "Чаевые к выплате", width: 13, style: "money", value: (r) => r.tipRemaining },
    );
  }

  const last = columns.length - 1;
  const title = `Зарплатная ведомость за ${monthNominative} ${year}`;
  const meta = [
    `Сформировано ${generatedLabel(input.generatedAt, input.timezone)}`,
    input.conditions.length ? `Отбор: ${input.conditions.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const pad = (cells: XlsxCell[]) => [...cells, ...Array(last + 1 - cells.length).fill(null)];

  const head = 4; // 0-based index of the header row
  const rows: XlsxCell[][] = [
    pad([{ v: title, s: "title" }]),
    pad([{ v: input.venueName ?? "", s: "subtitle" }]),
    pad([{ v: meta, s: "subtitle" }]),
    pad([]),
    columns.map((c, i) => ({ v: c.title, s: i < 2 ? "header" : "headerRight" })),
  ];
  for (const r of input.rows) {
    const e = extras.get(r.employee.id)!;
    rows.push(
      columns.map((c) => {
        const v = c.value(r, e);
        if (v === null) return { v: "—", s: "muted" };
        // Текст в денежном столбце — пояснение вместо суммы («уточняется»).
        if (typeof v === "string" && c.style !== "text") return { v, s: "muted" };
        return c.blankZero && v === 0 ? null : { v, s: c.style };
      }),
    );
  }
  const first = head + 1;
  const lastData = head + input.rows.length;
  const count = input.rows.length;
  rows.push(
    columns.map((c, i) => {
      if (i === 0)
        return { v: `Итого: ${count} ${plural(count, "сотрудник", "сотрудника", "сотрудников")}`, s: "totalText" };
      if (c.total === "none") return { v: null, s: "totalText" };
      const values = input.rows.map((r) => c.value(r, extras.get(r.employee.id)!));
      if (values.some((v) => v === null)) return { v: "—", s: "totalText" };
      const sum =
        c.style === "money"
          ? fromCents(values.reduce<number>((s, v) => s + (typeof v === "number" ? cents(v) : 0), 0))
          : Math.round(values.reduce<number>((s, v) => s + Number(v), 0) * 10) / 10;
      const style: XlsxStyle =
        c.style === "money" ? "totalMoney" : c.style === "hours" ? "totalHours" : "totalInt";
      return count
        ? { v: sum, s: style, f: `SUBTOTAL(9,${cellRef(first, i)}:${cellRef(lastData, i)})` }
        : { v: 0, s: style };
    }),
  );
  const notes = [
    "Начислено — сумма составляющих слева, удержания со знаком минус. Чаевые учитываются отдельно от зарплаты.",
    official
      ? "К выплате = перенос с прошлых месяцев + начислено − выплачено − перенесено далее − официальная часть (ожидается). Отрицательная сумма — переплата."
      : "К выплате = перенос с прошлых месяцев + начислено − выплачено − перенесено далее. Отрицательная сумма — переплата.",
    official
      ? "Официальная часть (ожидается) — оклад по договору до вычета НДФЛ. Его выплатит бухгалтерия; после проведения сумма войдёт в «Выплачено»."
      : null,
    known ? null : "Выплачено и К выплате появятся после сверки прежних выплат за месяц.",
  ].filter((n): n is string => !!n);
  rows.push(pad([]));
  const noteRows = notes.map((n) => rows.push(pad([{ v: n, s: "note" }])) - 1);

  const statement: XlsxSheet = {
    name: "Ведомость",
    rows,
    widths: columns.map((c) => c.width),
    heights: { 0: 22, [head]: 32, ...Object.fromEntries(noteRows.map((r) => [r, 28])) },
    freeze: { rows: head + 1, cols: 1 },
    merges: [
      `A1:${columnName(last)}1`,
      `A2:${columnName(last)}2`,
      `A3:${columnName(last)}3`,
      ...noteRows.map((r) => `A${r + 1}:${columnName(last)}${r + 1}`),
    ],
    autoFilter: count ? `A${head + 1}:${columnName(last)}${lastData + 1}` : undefined,
    printTitleRows: [head + 1, head + 1],
    landscape: true,
  };

  // ── По сменам ─────────────────────────────────────────────
  const names = new Map(input.rows.map((r) => [r.employee.id, r.employee]));
  const byShift = [...monthAccruals].sort(
    (a, b) =>
      a.business_date.localeCompare(b.business_date) ||
      (names.get(a.employee_id)?.name ?? "").localeCompare(names.get(b.employee_id)?.name ?? "", "ru"),
  );
  const money = (n: number) =>
    new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      .format(n)
      .replace("-", "−");
  const kindLabel = (a: Accrual) =>
    isShiftAccrual(a)
      ? "Смена"
      : a.calculation_snapshot.kind === "monthly"
        ? "Оклад"
        : "Запись журнала";
  const subtitle = [input.venueName, meta].filter(Boolean).join(" · ");
  const shiftHead = 2;
  const shiftRows: XlsxCell[][] = [
    [{ v: `Начисления по дням за ${monthNominative} ${year}`, s: "title" }, null, null, null, null, null, null],
    [{ v: subtitle, s: "subtitle" }, null, null, null, null, null, null],
    ["Дата", "Сотрудник", "Должность", "Вид", "Начислено", "Чаевые", "Из чего сложилось"].map((v, i) => ({
      v,
      s: (i === 4 || i === 5 ? "headerRight" : "header") as XlsxStyle,
    })),
  ];
  for (const a of byShift) {
    const employee = names.get(a.employee_id);
    shiftRows.push([
      ddmmyyyy(a.business_date),
      employee?.name ?? "",
      accrualRole(a, employee?.role_name ?? "", { models: input.models, roles: input.roles }) || "—",
      kindLabel(a),
      { v: Number(a.salary), s: "money" },
      { v: Number(a.tips), s: "money" },
      {
        v: a.components
          .filter((c) => c.kind !== "tips" && c.amount !== null && Number(c.amount) !== 0)
          .map((c) => `${c.label} ${money(Number(c.amount))}`)
          .join("; "),
        s: "wrap",
      },
    ]);
  }
  const shiftFirst = shiftHead + 1;
  const shiftLast = shiftHead + byShift.length;
  shiftRows.push([
    { v: `Итого: ${byShift.length} ${plural(byShift.length, "запись", "записи", "записей")}`, s: "totalText" },
    { v: null, s: "totalText" },
    { v: null, s: "totalText" },
    { v: null, s: "totalText" },
    byShift.length
      ? {
          v: fromCents(byShift.reduce((s, a) => s + cents(Number(a.salary)), 0)),
          s: "totalMoney",
          f: `SUBTOTAL(9,E${shiftFirst + 1}:E${shiftLast + 1})`,
        }
      : { v: 0, s: "totalMoney" },
    byShift.length
      ? {
          v: fromCents(byShift.reduce((s, a) => s + cents(Number(a.tips)), 0)),
          s: "totalMoney",
          f: `SUBTOTAL(9,F${shiftFirst + 1}:F${shiftLast + 1})`,
        }
      : { v: 0, s: "totalMoney" },
    { v: null, s: "totalText" },
  ]);
  const shifts: XlsxSheet = {
    name: "Начисления по дням",
    rows: shiftRows,
    widths: [12, 30, 22, 16, 14, 12, 70],
    heights: { 0: 22, [shiftHead]: 24 },
    freeze: { rows: shiftHead + 1 },
    merges: ["A1:G1", "A2:G2"],
    autoFilter: byShift.length ? `A${shiftHead + 1}:G${shiftLast + 1}` : undefined,
    printTitleRows: [shiftHead + 1, shiftHead + 1],
    landscape: true,
  };

  // ── Выплаты ───────────────────────────────────────────────
  const payHead = 2;
  const payRows: XlsxCell[][] = [
    [{ v: `Выплаты за ${monthNominative} ${year}`, s: "title" }, null, null, null, null],
    [{ v: subtitle, s: "subtitle" }, null, null, null, null],
    ["Дата", "Сотрудник", "Статья", "Сумма", "Статус"].map((v, i) => ({
      v,
      s: (i === 3 ? "headerRight" : "header") as XlsxStyle,
    })),
  ];
  const payments = [...input.payments].sort((a, b) => a.date.localeCompare(b.date));
  for (const p of payments) {
    payRows.push([
      new Date(p.date).toLocaleDateString("ru-RU", { timeZone: input.timezone }),
      p.employee,
      p.kind,
      { v: p.amount, s: "money" },
      p.posted ? p.status : { v: p.status, s: "subtitle" },
    ]);
  }
  payRows.push([
    { v: "Итого проведено", s: "totalText" },
    { v: null, s: "totalText" },
    { v: null, s: "totalText" },
    {
      v: fromCents(payments.filter((p) => p.posted).reduce((s, p) => s + cents(p.amount), 0)),
      s: "totalMoney",
    },
    { v: null, s: "totalText" },
  ]);
  const paymentsSheet: XlsxSheet = {
    name: "Выплаты",
    rows: payRows,
    widths: [12, 36, 26, 15, 14],
    heights: { 0: 22, [payHead]: 24 },
    freeze: { rows: payHead + 1 },
    merges: ["A1:E1", "A2:E2"],
    autoFilter: payments.length ? `A${payHead + 1}:E${payHead + payments.length + 1}` : undefined,
    printTitleRows: [payHead + 1, payHead + 1],
  };

  return [statement, shifts, paymentsSheet];
}

/** Payments journal alone (the «Выплаты» tab export). */
export function paymentsWorkbook(input: Pick<StatementExportInput, "month" | "timezone" | "venueName" | "generatedAt" | "conditions" | "payments">): XlsxSheet[] {
  const [, , sheet] = statementWorkbook({
    ...input,
    rows: [],
    accruals: [],
    attendance: [],
    models: [],
    paidKnown: true,
  });
  return [sheet];
}
