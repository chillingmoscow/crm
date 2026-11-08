import { redirect } from "next/navigation";
import { loadPayroll } from "@/app/(dashboard)/people/payroll/actions";
import { getCachedPermissions, getCachedUser } from "@/lib/supabase/server";
import { validDate } from "@/lib/sales/time";
import { ScheduleAttendanceClient } from "./attendance-client";

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; month?: string }>;
}) {
  if (!(await getCachedUser())) redirect("/login");
  if (!(await getCachedPermissions()).includes("payroll.view")) redirect("/schedule");
  const query = await searchParams;
  const date = query.date && validDate(query.date) ? query.date : undefined;
  const data = await loadPayroll();
  const month = date?.slice(0, 7) ??
    (query.month && validDate(`${query.month}-01`)
      ? query.month
      : new Date().toLocaleDateString("sv-SE", { timeZone: data.timezone }).slice(0, 7));
  return <ScheduleAttendanceClient key={date ?? month} initial={data} month={month} date={date} />;
}
