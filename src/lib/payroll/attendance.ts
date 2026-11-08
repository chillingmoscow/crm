import { businessDate, dayWindow } from "@/lib/sales/time";
import type { Shift } from "@/lib/schedule/types";
import type { PayEmployee, Attendance, AttendanceRule, ScheduleReview, ShiftAttendanceSnapshot } from "./types";
type AttendanceDraft = Pick<Attendance, "external_id" | "employee_id" | "business_date" |
  "starts_at" | "ends_at" | "shift_id" | "role_name" | "status" | "issue"> & {
  schedule_review_override?: boolean;
};
export function attendanceRuleAtDate(rules:AttendanceRule[],employeeId:string,date:string) {
 return rules.filter(r=>r.employee_id===employeeId&&r.valid_from<=date).sort((a,b)=>b.valid_from.localeCompare(a.valid_from)||b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id))[0]??null;
}
function plannedEmployee(shift:Shift,employees:PayEmployee[]) {
 return shift.payroll_employee_id?employees.find(e=>e.id===shift.payroll_employee_id&&e.attendance_source!=="excluded"):employees.find(e=>e.local_user_id&&e.local_user_id===shift.user_id&&e.attendance_source==="schedule");
}
function scheduledAttendance(shift: Shift, employee: PayEmployee | undefined, date: string): AttendanceDraft {
  if (!Number.isSafeInteger(shift.payroll_fact_id) || shift.payroll_fact_id! >= 0)
    throw new Error("Не задан ID записи графика");
  return {
    external_id: shift.payroll_fact_id!,
    employee_id: employee?.id ?? null,
    business_date: date,
    starts_at: shift.starts_at,
    ends_at: shift.ends_at,
    shift_id: shift.id,
    role_name: employee?.role_name ?? "",
    status: "confirmed",
    issue: null,
  };
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
    return scheduledAttendance(s, e, date);
  });
  const missing = future
    ? []
    : shifts
        .filter(
          (s) =>
            s.published &&
            s.user_id &&
            Date.parse(s.ends_at) <= Date.now() &&
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

export function applyScheduleReviews(
  reconciled: { items: AttendanceDraft[]; missing: ReturnType<typeof reconcileAttendance>["missing"] },
  shifts: Shift[],
  reviews: ScheduleReview[],
  date: string,
  fallbackFrom: string | null,
  prior: Attendance[] = [],
) {
  const reviewByShift = new Map(reviews.flatMap((review) => {
    const shift = shifts.find((s) => s.id === review.shift_id);
    if (!shift?.published || shift.user_id !== review.snapshot.user_id ||
        (shift.payroll_employee_id ?? null) !== (review.snapshot.payroll_employee_id ?? null) ||
        Date.parse(shift.starts_at) !== Date.parse(review.snapshot.starts_at) ||
        Date.parse(shift.ends_at) !== Date.parse(review.snapshot.ends_at)) return [];
    return [[shift.id, { review, shiftVersion: shift.version }] as const];
  }));
  const marks: Record<string, ShiftAttendanceSnapshot> = {};
  const items = reconciled.items.map((item) => {
    const entry = item.shift_id ? reviewByShift.get(item.shift_id) : undefined;
    const review = entry?.review;
    if (!entry || review?.employee_id !== item.employee_id || !review?.decision) return item;
    const state = review.decision === "exclude" ? "excluded" : "included";
    marks[review.shift_id] = {
      state,
      shiftVersion: entry.shiftVersion,
      reason: review.reason,
      hasQuickResto: item.external_id > 0,
    };
    return review.decision === "exclude"
      ? { ...item, status: "ignored" as const, issue: review.reason, schedule_review_override: true }
      : item;
  });
  const missing = [];
  const qrEmployees = new Set(reconciled.items.filter((item) =>
    item.external_id > 0 && item.status !== "ignored",
  ).map((item) => item.employee_id));
  for (const entry of reconciled.missing) {
    const { shift, employee } = entry;
    const savedReview = reviewByShift.get(shift.id)?.review;
    const review = savedReview?.employee_id === (employee?.id ?? null) ? savedReview : undefined;
    const hasQuickResto = employee ? qrEmployees.has(employee.id) : false;
    const details = { shiftVersion: shift.version, hasQuickResto };
    if (review && (!review.decision || review.decision === "exclude")) {
      marks[shift.id] = { ...details, state: "excluded", reason: review.reason };
      continue;
    }
    const alreadyCounted = employee && prior.some((fact) =>
      fact.external_id === shift.payroll_fact_id && fact.shift_id === shift.id &&
      fact.employee_id === employee.id && fact.status === "confirmed" &&
      Date.parse(fact.starts_at) === Date.parse(shift.starts_at) &&
      !!fact.ends_at && Date.parse(fact.ends_at) === Date.parse(shift.ends_at),
    );
    const automatic = fallbackFrom && Date.parse(shift.starts_at) >= Date.parse(fallbackFrom) &&
      (employee?.active || alreadyCounted) && !hasQuickResto;
    if (employee && (review?.decision === "include" || automatic)) {
      marks[shift.id] = review
        ? { ...details, state: "included", reason: review.reason }
        : { ...details, state: "scheduled" };
      items.push(scheduledAttendance(shift, employee, date));
    } else {
      missing.push(entry);
      marks[shift.id] = { ...details, state: "missing" };
    }
  }
  return { items, missing, marks };
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
