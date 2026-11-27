import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { loadPayroll } from "../actions";
import { unwrapAction } from "@/lib/actions/result";
import { validDate } from "@/lib/sales/time";
import { EmployeePayrollPage } from "../_components/employee-payroll-page";
import { createClient, getCachedPermissionChecker } from "@/lib/supabase/server";

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
  const employee = data.employees.find((e) => e.id === employeeId);
  if (!employee) notFound();
  const pickedMonth =
    query.month && /^\d{4}-\d{2}$/.test(query.month) && validDate(`${query.month}-01`)
      ? query.month
      : null;
  // Расчёт сотрудника с карточкой — вкладка «Оплата» этой карточки: один
  // экран, а не два одинаковых. Здесь остаются разовые из Quick Resto (у них
  // карточки нет) и те, кому карточка не открыта правами.
  if (employee.local_user_id && (await staffCardOpens(employee.local_user_id, data.venueId)))
    redirect(
      `/people/staff/${employee.local_user_id}?tab=pay&from=payroll${pickedMonth ? `&month=${pickedMonth}` : ""}`,
    );
  const month =
    pickedMonth
      ? `${pickedMonth}-01`
      : // Без ?month — текущий месяц заведения, как в списке «Зарплаты»,
        // а не месяц начала учёта.
        `${(data.asOfDate ?? new Date().toISOString()).slice(0, 7)}-01`;
  return (
    <EmployeePayrollPage initial={data} employeeId={employeeId} month={month}/>
  );
}

/**
 * Откроется ли карточка сотрудника: те же права, что проверяет её страница, и
 * сотрудник состоит в заведении (работает или уволен) — иначе карточка сама
 * отправит в список сотрудников.
 */
async function staffCardOpens(userId: string, venueId: string | null): Promise<boolean> {
  const can = await getCachedPermissionChecker();
  if (!venueId || !can("people.view_staff") || !can("people.view_staff_details")) return false;
  const { data } = await (await createClient())
    .from("user_venue_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("venue_id", venueId)
    .in("status", ["active", "fired"])
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}
