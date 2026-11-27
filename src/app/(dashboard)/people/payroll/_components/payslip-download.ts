"use client";

import { accrualRole } from "@/lib/payroll/accrual-view";
import { buildPayslip, payslipFileName } from "@/lib/payroll/payslip";
import type { PayEmployee, PayrollData } from "@/lib/payroll/types";

/**
 * Выписка сотрудника за месяц в PDF — скачивается в браузере из уже
 * загруженных данных. Одна на расчётный лист и на меню строки ведомости.
 * Бросает исключение, если файл не собрался: сообщение показывает вызывающий.
 */
export async function downloadPayslip(data: PayrollData, employee: PayEmployee, month: string) {
  const payslip = buildPayslip(data, employee, month, (a) => accrualRole(a, employee.role_name, data));
  // The PDF renderer is heavy: it is loaded only when a statement is requested.
  const { renderPayslip } = await import("@/lib/payroll/payslip-pdf");
  const blob = await renderPayslip(payslip, `${window.location.origin}/fonts/inter`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = payslipFileName(payslip);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
