import { z } from "zod";
import { dayWindow, validDate } from "./time";

export const cashControlRulesSchema = z
  .object({
    thresholdCents: z.number().int().min(0).max(10000000000),
    opening: z.boolean(),
    closing: z.boolean(),
    autoRead: z.boolean(),
    intervalMinutes: z.number().int().min(15).max(1440),
  })
  .strict();
export type CashControlRules = z.infer<typeof cashControlRulesSchema>;
export const initialCashControlRules: CashControlRules = {
  thresholdCents: 0,
  opening: true,
  closing: true,
  autoRead: false,
  intervalMinutes: 60,
};
export type CashControlReport = {
  id: number;
  shiftNumber: number | null;
  openedAt: string;
  closedAt: string | null;
  terminalId: string;
  terminal: string;
  cashier: string;
  status: "OPENED" | "CLOSED";
  incomplete: boolean;
  openExpected: number | null;
  openDeclared: number | null;
  closeExpected: number | null;
  closeDeclared: number | null;
};
type Obj = Record<string, unknown>;
function obj(v: unknown): Obj {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Некорректный кассовый отчёт Quick Resto");
  return v as Obj;
}
function stamp(v: unknown): string {
  if (
    typeof v !== "string" ||
    !validDate(v.slice(0, 10)) ||
    !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    throw new Error("Нет подтверждённого времени кассовой смены");
  return new Date(v).toISOString();
}
function cents(v: unknown): number | null {
  if (v == null) return null;
  if (
    typeof v === "boolean" ||
    v === "" ||
    !Number.isFinite(Number(v)) ||
    Math.abs(Number(v)) > 1000000000 ||
    Math.abs(Number(v) * 100 - Math.round(Number(v) * 100)) > 0.000001
  )
    throw new Error("Некорректная сумма кассового контроля");
  return Math.round(Number(v) * 100);
}
function text(v: unknown, fallback = "") {
  if (v == null) return fallback;
  if (typeof v !== "string")
    throw new Error("Некорректное название в кассовом отчёте");
  return v.trim().slice(0, 300) || fallback;
}
function identifier(v: unknown) {
  const n = Number(v);
  if (typeof v === "boolean" || !Number.isSafeInteger(n) || n <= 0)
    throw new Error("Некорректный ID кассового отчёта");
  return n;
}
/** Public QR list returns the full array. No pagination cutoff or null-to-zero conversion. */
export function normalizeCashControl(
  raw: unknown,
  date: string,
  timezone: string,
  hour: number,
): CashControlReport[] {
  if (!validDate(date) || !Array.isArray(raw) || raw.length > 10000)
    throw new Error("Не подтверждён полный список кассовых отчётов");
  const window = dayWindow(date, timezone, hour),
    ids = new Set<number>(),
    result: CashControlReport[] = [];
  for (const item of raw) {
    const r = obj(item),
      id = identifier(r.id),
      openedAt = stamp(r.opened),
      opened = Date.parse(openedAt);
    if (ids.has(id)) throw new Error("Кассовые отчёты повторяются");
    ids.add(id);
    if (opened < window.start || opened >= window.end) continue;
    const status = String(r.status ?? "").toUpperCase();
    if (status !== "OPENED" && status !== "CLOSED")
      throw new Error("Неизвестное состояние кассовой смены");
    const terminal = r.kkmTerminal == null ? {} : obj(r.kkmTerminal),
      place = r.salePlace == null ? {} : obj(r.salePlace),
      employee = r.openedEmployee == null ? {} : obj(r.openedEmployee);
    if (
      terminal.id != null &&
      typeof terminal.id !== "string" &&
      typeof terminal.id !== "number"
    )
      throw new Error("Не подтверждена касса");
    result.push({
      id,
      shiftNumber: r.shiftNumber == null ? null : identifier(r.shiftNumber),
      openedAt,
      closedAt: r.closed == null ? null : stamp(r.closed),
      status,
      incomplete: r.incomplete !== false,
      terminalId: terminal.id == null ? "" : String(terminal.id),
      terminal: text(
        terminal.title,
        text(place.title, `Касса · смена №${r.shiftNumber ?? id}`),
      ),
      cashier: text(employee.fullName, text(employee.shortName, "Не указан")),
      openExpected: cents(r.openCashInRegister),
      openDeclared: cents(r.enteredOpenCashInRegister),
      closeExpected: status === "CLOSED" ? cents(r.closeCashInRegister) : null,
      closeDeclared:
        status === "CLOSED" ? cents(r.enteredCloseCashInRegister) : null,
    });
  }
  return result.sort((a, b) => a.id - b.id);
}
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Obj)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
export function sameCashControl(
  a: CashControlReport[],
  b: CashControlReport[],
) {
  return canonical(a) === canonical(b);
}
export function cashControlResults(
  reports: CashControlReport[],
  rawRules: CashControlRules,
) {
  const rules = cashControlRulesSchema.parse(rawRules);
  return reports.flatMap((r) =>
    (["open", "close"] as const).flatMap((kind) => {
      if (
        kind === "open"
          ? !rules.opening
          : !rules.closing || r.status !== "CLOSED"
      )
        return [];
      const expected = kind === "open" ? r.openExpected : r.closeExpected,
        declared = kind === "open" ? r.openDeclared : r.closeDeclared;
      const diff =
        expected === null || declared === null || r.incomplete
          ? null
          : declared - expected;
      return [
        {
          key: `${r.id}:${kind}`,
          reportId: r.id,
          kind,
          expected,
          declared,
          diff,
          state:
            diff === null
              ? ("unknown" as const)
              : diff === 0
                ? ("matched" as const)
                : Math.abs(diff) <= rules.thresholdCents
                  ? ("tolerated" as const)
                  : diff < 0
                    ? ("shortage" as const)
                    : ("overage" as const),
        },
      ];
    }),
  );
}
