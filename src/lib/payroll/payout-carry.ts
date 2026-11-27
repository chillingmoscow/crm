// Автоперенос остатка месяца после второй выплаты (план выплат, этап 3).
// Чистые функции — их гоняет node --test.
//
// Когда окно второй выплаты за M прошло и все строки плана закрыты, остаток
// M каждого сотрудника плана — плюс или минус — переносится на M+1 тем же
// переносом, что и вручную. Сумма — как в ручной панели переноса
// (transferableBalance): переплату, возникшую только из-за ещё не
// проведённой официальной части, не переносим.

import { round, statementRows, transferableBalance } from "./calculate.ts";
import { transferReason } from "./transfer-reason.ts";
import type { PayrollData } from "./types.ts";

export type CarryRow = { employee_id: string; amount: number; issued: number; state: string };
export type CarryWaiting = { employee_id: string; remainder: number };
export type CarryItem = { employee_id: string; amount: number; reason: string };

/**
 * Строки, которые держат перенос: по плану выдано не всё, и невыданное всё
 * ещё причитается (свежий расчёт второй выплаты не меньше остатка строки).
 * Выплатили вручную или уменьшили сумму строки до выданного — строка закрыта.
 */
export function carryWaiting(rows: CarryRow[], freshDue: Map<string, number>): CarryWaiting[] {
  return rows.flatMap((row) => {
    const remainder = round(row.amount - row.issued);
    if (row.state === "issued" || remainder <= 0) return [];
    return (freshDue.get(row.employee_id) ?? 0) >= remainder ? [{ employee_id: row.employee_id, remainder }] : [];
  });
}

const nextMonth = (month: string) => {
  const d = new Date(`${month}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
};

/** Что перенести: ненулевой остаток M по каждому сотруднику плана, со знаком. */
export function carryItems(
  data: Pick<PayrollData, "employees" | "accruals" | "adjustments" | "payments" | "allocations" | "transfers" | "settings" | "officialExpected">,
  month: string,
  employeeIds: string[],
): CarryItem[] {
  const ids = new Set(employeeIds);
  const target = nextMonth(month);
  return statementRows(
    data.employees.filter((e) => ids.has(e.id)),
    data.accruals, data.adjustments, data.payments, data.allocations, month,
    data.transfers, data.settings?.starts_on ?? month, data.officialExpected ?? [],
  ).flatMap((row) => {
    const { amount } = transferableBalance(row);
    if (Math.round(amount * 100) === 0) return [];
    return [{
      employee_id: row.employee.id,
      amount: round(amount * Math.sign(row.remaining)),
      reason: transferReason(row.remaining, month, target),
    }];
  });
}
