import { businessDate, dayWindow } from "@/lib/sales/time";
import type { Shift } from "@/lib/schedule/types";
import type { PayEmployee, Attendance, AttendanceRule } from "./types";
export function attendanceRuleAtDate(rules:AttendanceRule[],employeeId:string,date:string) {
 return rules.filter(r=>r.employee_id===employeeId&&r.valid_from<=date).sort((a,b)=>b.valid_from.localeCompare(a.valid_from)||b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id))[0]??null;
}
function plannedEmployee(shift:Shift,employees:PayEmployee[]) {
 return shift.payroll_employee_id?employees.find(e=>e.id===shift.payroll_employee_id&&e.attendance_source!=="excluded"):employees.find(e=>e.local_user_id&&e.local_user_id===shift.user_id&&e.attendance_source==="schedule");
}
export function reconcileAttendance(
  rows: {
    id: number;
    owner: { id: number };
    startTime: number;
    endTime?: number | null;
  }[],
  employees: PayEmployee[],
  shifts: Shift[],
  date: string,
  timezone: string,
  hour: number,
) {
  const starts = businessDate(new Date(), timezone, hour),
    future = date >= starts;
  const matched = new Set<string>();
  const scheduled = shifts.filter(
    (s) =>
      plannedEmployee(s,employees) &&
      s.published &&
      Date.parse(s.ends_at) <= Date.now() &&
      businessDate(new Date(s.starts_at), timezone, hour) === date,
  );
  const items = rows
    .filter(
      (r) =>
        !employees.some(e=>(e.attendance_source==="schedule"||e.attendance_source==="excluded")&&e.quickresto_id!==null&&e.quickresto_id===Number(r.owner?.id)) && !scheduled.some((s) =>
          employees.some(
            (e) =>
              e.id === plannedEmployee(s,employees)?.id &&
              Number(e.quickresto_id) === Number(r.owner?.id),
          ),
        ),
    )
    .map((r) => {
      const e = employees.find(
        (e) => Number(e.quickresto_id) === Number(r.owner?.id),
      );
      const candidates = e?.local_user_id
        ? shifts.filter(
            (s) =>
              s.user_id === e.local_user_id &&
              s.published &&
              Date.parse(s.starts_at) < (r.endTime ?? r.startTime + 86400000) &&
              Date.parse(s.ends_at) > r.startTime,
          )
        : [];
      const shift = candidates.length === 1 ? candidates[0] : null;
      if (shift) matched.add(shift.id);
      let status: Attendance["status"] = "confirmed",
        issue: string | null = null;
      if (!e) {
        status = "unlinked";
        issue = "Сотрудник Quick Resto не связан с оплатой труда";
      } else if (!r.endTime) {
        status = "open";
        issue = "Личная смена ещё не закрыта";
      } else if (
        businessDate(new Date(r.startTime), timezone, hour) !== date ||
        (r.endTime !== null &&
          r.endTime !== undefined &&
          r.endTime >= dayWindow(date, timezone, hour).end)
      ) {
        status = "deviation";
        issue = "Личная смена пересекает границу рабочего дня";
      } else if (candidates.length > 1) {
        status = "deviation";
        issue = "Несколько подходящих смен в графике";
      } else if (!shift) {
        status = "unplanned";
        issue = "Фактический выход без опубликованной смены в Sheerly";
      } else if (
        Math.abs(r.startTime - Date.parse(shift.starts_at)) > 15 * 60000 ||
        Math.abs(r.endTime - Date.parse(shift.ends_at)) > 15 * 60000
      ) {
        status = "deviation";
        issue = "План и факт отличаются более чем на 15 минут";
      }
      return {
        external_id: r.id,
        employee_id: e?.id ?? null,
        business_date: date,
        starts_at: new Date(r.startTime).toISOString(),
        ends_at: r.endTime ? new Date(r.endTime).toISOString() : null,
        shift_id: shift?.id ?? null,
        role_name: e?.role_name ?? "",
        status,
        issue,
      };
    });
  const scheduleItems = scheduled.map((s) => {
    const e = plannedEmployee(s,employees);
    matched.add(s.id);
    if (!Number.isSafeInteger(s.payroll_fact_id) || s.payroll_fact_id! >= 0)
      throw new Error("Не задан ID записи графика");
    return {
      external_id: s.payroll_fact_id!,
      employee_id: e?.id ?? null,
      business_date: date,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      shift_id: s.id,
      role_name: e?.role_name ?? "",
      status: "confirmed" as const,
      issue: null,
    };
  });
  const missing = future
    ? []
    : shifts
        .filter(
          (s) =>
            s.published &&
            s.user_id &&
            !matched.has(s.id) &&
            !employees.some(e=>e.local_user_id===s.user_id&&(e.attendance_source==="schedule"||e.attendance_source==="excluded")) &&
            businessDate(new Date(s.starts_at), timezone, hour) === date,
        )
        .map((s) => ({
          shift: s,
          employee: employees.find((e) => e.local_user_id === s.user_id),
        }));
  return { items: [...items, ...scheduleItems], missing };
}

// Schedule discrepancies are informational. Only missing or ambiguous cash-register facts block salary.
export function blocksPayrollAttendance(
  a: Pick<Attendance, "status" | "issue" | "ends_at">,
) {
  return (
    a.status !== "ignored" &&
    (a.status === "unlinked" ||
      a.status === "open" ||
      !a.ends_at ||
      (a.status === "deviation" && !!a.issue?.includes("границ")))
  );
}

export function payrollFactRows<T extends {owner:{id:number}}>(rows:T[],employees:PayEmployee[]):T[] {
 return rows.filter(r=>!employees.some(e=>e.attendance_source==="excluded"&&e.quickresto_id!==null&&e.quickresto_id===Number(r.owner.id)));
}
