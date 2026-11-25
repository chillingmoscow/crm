import type { CashControlReport } from "../sales/cash-control.ts";
import { floorStep } from "./payout-plan.ts";

// Выдача дня по плану: сколько наличных в кассах, кому сколько хватает,
// и текст сообщения менеджерам. Чистые функции — их гоняет node --test.

export type RegisterCash = {
  terminalId: string;
  terminal: string;
  /** Рубли. */
  amount: number;
  /** open — по открытию сегодняшней смены, close — по закрытию последней. */
  source: "open" | "close";
  at: string;
};

/**
 * Наличные по каждой кассе: открытая сегодня смена, иначе последнее закрытие
 * сегодня, иначе последнее закрытие вчера. Суммы Quick Resto — в копейках.
 * null — ни по одной кассе нет данных.
 */
export function registerCash(
  today: CashControlReport[],
  yesterday: CashControlReport[],
): RegisterCash[] | null {
  const key = (r: CashControlReport) => r.terminalId || `title:${r.terminal}`;
  const order: string[] = [];
  for (const r of [...today, ...yesterday]) if (!order.includes(key(r))) order.push(key(r));
  const latestClosed = (list: CashControlReport[]) =>
    list
      .filter((r) => r.status === "CLOSED")
      .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""))[0];
  const result: RegisterCash[] = [];
  for (const k of order) {
    const own = (list: CashControlReport[]) => list.filter((r) => key(r) === k);
    const opened = own(today).find((r) => r.status === "OPENED");
    const closed = latestClosed(own(today)) ?? latestClosed(own(yesterday));
    const pick =
      opened && opened.openExpected !== null
        ? { report: opened, kopecks: opened.openExpected, source: "open" as const, at: opened.openedAt }
        : closed && closed.closeExpected !== null
          ? { report: closed, kopecks: closed.closeExpected, source: "close" as const, at: closed.closedAt ?? closed.openedAt }
          : null;
    if (!pick) continue;
    result.push({
      terminalId: pick.report.terminalId,
      terminal: pick.report.terminal,
      amount: Math.round(pick.kopecks) / 100,
      source: pick.source,
      at: pick.at,
    });
  }
  return result.length ? result : null;
}

/** Можно выдать: наличные касс минус минимум минус уже выданное сегодня; не меньше 0. */
export function cashAvailable(registers: RegisterCash[], minimum: number, issuedToday: number): number {
  const total = registers.reduce((s, r) => s + r.amount, 0);
  return Math.max(0, Math.round((total - minimum - issuedToday) * 100) / 100);
}

export type DueRow = {
  row_id: string;
  employee_id: string;
  name: string;
  due: number;
  next_pay_date: string | null;
  /** Сумма срезана потолком: выдав её целиком, строку закрываем. */
  capped?: boolean;
};
export type IssueLine = {
  row_id: string;
  employee_id: string;
  name: string;
  amount: number;
  next_pay_date: string | null;
  /** Закрыть строку на выданной сумме (урезанная потолком). */
  close: boolean;
};

/**
 * От меньших сумм к большим: целиком, пока хватает; следующей — сколько
 * осталось, вниз до шага; остальным — ничего. `short` — кому выдано не всё.
 */
export function distributeCash(
  rows: DueRow[],
  available: number,
  step: number,
): { lines: IssueLine[]; short: DueRow[] } {
  const sorted = [...rows].sort((a, b) => a.due - b.due || a.name.localeCompare(b.name, "ru"));
  const lines: IssueLine[] = [];
  const short: DueRow[] = [];
  let left = Math.max(0, available);
  for (const row of sorted) {
    if (row.due <= 0) continue;
    if (row.due <= left) {
      lines.push({ ...line(row, row.due, row.capped === true), next_pay_date: null });
      left -= row.due;
      continue;
    }
    const part = floorStep(left, step);
    if (part > 0) lines.push(line(row, part, false));
    left = 0;
    short.push(row);
  }
  return { lines, short };
}
const line = (row: DueRow, amount: number, close: boolean): IssueLine => ({
  row_id: row.row_id, employee_id: row.employee_id, name: row.name, amount, next_pay_date: row.next_pay_date, close,
});

/** 65 000 → «65К», 7 500 → «7 500». */
export function formatPayoutAmount(amount: number): string {
  const n = Math.round(amount);
  if (n % 1000 === 0) return `${n / 1000}К`;
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function payoutMessage(lines: { name: string; amount: number }[]): string {
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return [
    "Выдайте плиз и проведите:",
    ...lines.map((l) => `${l.name} — ${formatPayoutAmount(l.amount)}`),
    `Итого ${formatPayoutAmount(total)} — одним изъятием, в комментарии «ЗП»`,
  ].join("\n");
}
