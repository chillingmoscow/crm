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

/**
 * Сообщение менеджерам о выдаче: заголовок, сотрудники списком, итог
 * отдельной строкой, как провести — последней (Павел, 26.11: «чтобы
 * выглядело симпатично»). Обычный текст, без разметки: имена не экранируем.
 */
export function payoutMessage(lines: { name: string; amount: number }[]): string {
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return [
    "Зарплата на сегодня — выдайте из кассы:",
    "",
    ...lines.map((l) => `• ${l.name} — ${formatPayoutAmount(l.amount)}`),
    "",
    `Итого: ${formatPayoutAmount(total)}`,
    "Проведите одним изъятием с комментарием «ЗП».",
  ].join("\n");
}

export const NOBODY_DUE = "Сегодня по плану выдавать некому";

/** Автовыдача: некому — молча пропускаем; другая причина — сообщаем; иначе выдаём. */
export function autoIssueDecision(preview: { problem: string | null }): "skip" | "report" | "issue" {
  if (!preview.problem) return "issue";
  return preview.problem === NOBODY_DUE ? "skip" : "report";
}

/** Сообщение в чат отчётов, если автовыдача не прошла. */
export function autoReportText(venue: string, day: string, reason: string, waiting: string[]): string {
  return [
    `Зарплата ${day.slice(8, 10)}.${day.slice(5, 7)}, ${venue}: выдача по плану не проведена. ${reason}.`,
    waiting.length ? `Ждут выдачи: ${waiting.join(", ")}.` : null,
    "Выдайте вручную: Зарплата → План выплат → «Выдать сейчас».",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Кому не хватило наличных: без выдачи и со следующей сменой в окне —
 * переносим; без следующей смены (и частично выданных, и вовсе без выдачи) —
 * просим выбрать день вручную.
 */
export function splitShortfall(lines: IssueLine[], short: DueRow[]): { moves: DueRow[]; notMoved: string[] } {
  const moves: DueRow[] = [];
  const notMoved: string[] = [];
  for (const row of short) {
    const line = lines.find((l) => l.row_id === row.row_id);
    if (line) {
      if (!line.next_pay_date) notMoved.push(`${row.name} (остаток)`);
    } else if (row.next_pay_date) moves.push(row);
    else notMoved.push(row.name);
  }
  return { moves, notMoved };
}

/**
 * Кому сегодня не хватило наличных и перенести некуда (смен в окне больше
 * нет) — с невыданной суммой, для карточки «Не хватило наличных».
 */
export function shortfallRows(lines: IssueLine[], short: DueRow[]): { name: string; amount: number }[] {
  return short.flatMap((row) => {
    const line = lines.find((l) => l.row_id === row.row_id);
    if (line) return line.next_pay_date ? [] : [{ name: row.name, amount: Math.round((row.due - line.amount) * 100) / 100 }];
    return row.next_pay_date ? [] : [{ name: row.name, amount: row.due }];
  });
}

/** Отчёт после автовыдачи: null — всё прошло, говорить не о чем. */
export function autoIssuedReportText(
  day: string,
  o: { messageFailed: boolean; message: string; notMoved: string[]; movedSchedule: string[] },
): string | null {
  const parts = [
    o.messageFailed ? `Сообщение менеджерам не ушло, отправьте сами:\n${o.message}` : null,
    o.notMoved.length ? `Нет следующей смены в окне, выберите день в плане: ${o.notMoved.join(", ")}.` : null,
    o.movedSchedule.length ? `На другом графике выплат, по плану не выдано: ${o.movedSchedule.join(", ")}.` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return [`Зарплата ${day.slice(8, 10)}.${day.slice(5, 7)}: выдача по плану проведена.`, ...parts].join("\n");
}
