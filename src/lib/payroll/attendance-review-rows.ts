import { businessDate } from "../sales/time.ts";
import type { Attendance, PayrollData } from "./types";

/**
 * Строки сверки выходов за месяц (или один рабочий день): отметки Quick Resto
 * и опубликованные смены без отметки. Один расчёт на экран «Сверка отметок» и
 * на уведомления «N выходов ждут проверки» в «Расписании» и «Зарплате» —
 * чтобы число в уведомлении совпадало со списком «На проверке».
 */
export type AttendanceReviewRow = {
  id: string;
  employee: string;
  avatar: string | null;
  role: string;
  date: string;
  plan: string;
  actual: string;
  status: Attendance["status"];
  issue: string | null;
  attendance: Attendance | null;
  plannedShift: PayrollData["plannedShifts"][number] | null;
  noShow: boolean;
  awaitingSource: boolean;
};

export type AttendanceReviewInput = Pick<
  PayrollData,
  "attendance" | "plannedShifts" | "sources" | "scheduleReviews" | "employees" | "timezone" | "dayStartHour"
>;

export function attendanceReviewRows(
  data: AttendanceReviewInput,
  month: string,
  date?: string,
  now: number = Date.now(),
): AttendanceReviewRow[] {
  const time = (value: string) =>
    new Date(value).toLocaleTimeString("ru-RU", {
      timeZone: data.timezone,
      hour: "2-digit",
      minute: "2-digit",
    });
  const employees = new Map(data.employees.map((employee) => [employee.id, employee]));
  const staff = new Map(data.employees.map((employee) => [employee.local_user_id, employee]));
  const shifts = new Map(data.plannedShifts.map((shift) => [shift.id, shift]));
  const linkedShifts = new Set(
    data.attendance.filter((record) => record.status !== "ignored").map((record) => record.shift_id),
  );
  const sources = new Map(data.sources.map((source) => [source.business_date, source]));
  const reviews = new Map(data.scheduleReviews.map((review) => [review.shift_id, review]));
  const actual = data.attendance
    .filter((a) => (date ? a.business_date === date : a.business_date.startsWith(month)))
    .map((a): AttendanceReviewRow => {
      const e = a.employee_id ? employees.get(a.employee_id) : undefined;
      const shift = a.shift_id ? shifts.get(a.shift_id) : undefined;
      return {
        id: a.id,
        employee: e?.name ?? `Quick Resto · ${a.external_id}`,
        avatar: e?.avatar_url ?? null,
        role: a.role_name,
        date: a.business_date,
        plan: shift ? `${time(shift.starts_at)}–${time(shift.ends_at)}` : "—",
        actual: `${time(a.starts_at)}–${a.ends_at ? time(a.ends_at) : "…"}`,
        status: a.status,
        issue: a.reviewed_by ? a.review_reason : a.issue,
        attendance: a,
        plannedShift: null,
        noShow: false,
        awaitingSource: false,
      };
    });
  const missing = data.plannedShifts
    .filter(
      (s) =>
        s.published &&
        s.user_id &&
        businessDate(new Date(s.starts_at), data.timezone, data.dayStartHour).startsWith(month) &&
        Date.parse(s.ends_at) < now &&
        !linkedShifts.has(s.id),
    )
    .map((s): AttendanceReviewRow => {
      const day = businessDate(new Date(s.starts_at), data.timezone, data.dayStartHour),
        source = sources.get(day),
        e = staff.get(s.user_id);
      const review = reviews.get(s.id);
      const reviewed =
        review &&
        review.snapshot.user_id === s.user_id &&
        Date.parse(review.snapshot.starts_at) === Date.parse(s.starts_at) &&
        Date.parse(review.snapshot.ends_at) === Date.parse(s.ends_at)
          ? review
          : null;
      return {
        id: s.id,
        employee: e?.name ?? s.title,
        avatar: e?.avatar_url ?? null,
        role: e?.role_name ?? "",
        date: day,
        plan: `${time(s.starts_at)}–${time(s.ends_at)}`,
        actual: "—",
        status: reviewed ? "ignored" : "missing",
        issue:
          reviewed?.reason ??
          (source?.state === "complete"
            ? "В Quick Resto нет отметки выхода"
            : "Источник ещё не проверен. Отсутствие данных не означает невыход."),
        attendance: null,
        plannedShift: s,
        noShow: !!reviewed,
        awaitingSource: !reviewed && source?.state !== "complete",
      };
    });
  return [
    ...actual,
    ...missing.filter((row) => {
      if (date && row.date !== date) return false;
      const source = sources.get(row.date);
      return row.noShow || source?.state !== "complete" || source.missing_shifts?.includes(row.id);
    }),
  ];
}

/** Строка ждёт решения: данные за день получены, а выход не подтверждён и не исключён. */
export function needsAttendanceReview(row: AttendanceReviewRow) {
  return !row.awaitingSource && !["confirmed", "ignored"].includes(row.status);
}
