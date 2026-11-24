import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPayroll } from "../actions";
import { unwrapAction } from "@/lib/actions/result";
import { validDate } from "@/lib/sales/time";
import { EmployeePayrollPage } from "../_components/employee-payroll-page";

export const metadata: Metadata = { title: "Зарплата сотрудника" };

export default async function EmployeeSalaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<{ month?: string; tab?: string }>;
}) {
  const [{ employeeId }, query, data] = await Promise.all([
    params,
    searchParams,
    loadPayroll().then(unwrapAction),
  ]);
  // The loader applies venue and own-salary access rules before this lookup.
  if (!data.employees.some((employee) => employee.id === employeeId))
    notFound();
  const month =
    query.month &&
    /^\d{4}-\d{2}$/.test(query.month) &&
    validDate(`${query.month}-01`)
      ? `${query.month}-01`
      : // Без ?month — текущий месяц заведения, как в списке «Зарплаты»,
        // а не месяц начала учёта.
        `${(data.asOfDate ?? new Date().toISOString()).slice(0, 7)}-01`;
  return (
    <EmployeePayrollPage initial={data} employeeId={employeeId} month={month} initialTab={query.tab} />
  );
}
