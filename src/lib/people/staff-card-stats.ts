import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { addDays, businessDate, dayWindow } from "@/lib/sales/time";
import { buildPaySheet } from "@/lib/payroll/pay-sheet";
import type { Accrual } from "@/lib/payroll/types";
import { chunk, fetchAllRows } from "@/lib/supabase/fetch-all";
import { OPEN_CLOCK_MAX_HOURS, heatmapStart, hoursByDay } from "./staff-activity";

/** Часовой пояс и начало рабочего дня заведения. */
export type VenueClock = { timezone: string; dayStartHour: number };

type ShiftRow = { id: string; starts_at: string; ends_at: string };

const HOUR = 3_600_000;

async function employeeIds(venueId: string, userId: string): Promise<string[]> {
  const { data, error } = await asLooseDb(createAdminClient())
    .from<{ id: string }[]>("payroll_employees")
    .select("id")
    .eq("venue_id", venueId)
    .eq("local_user_id", userId);
  if (error) throw new Error("Не удалось загрузить данные сотрудника");
  return (data ?? []).map((e) => e.id);
}

/** Опубликованные смены сотрудника, начавшиеся в окне `[from, to)`. */
async function publishedShifts(
  venueId: string,
  userId: string,
  from: number,
  to: number,
): Promise<ShiftRow[]> {
  const db = asLooseDb(createAdminClient());
  try {
    return await fetchAllRows(() =>
      db
        .from<ShiftRow[]>("schedule_shifts")
        .select("id, starts_at, ends_at")
        .eq("venue_id", venueId)
        .eq("user_id", userId)
        .eq("published", true)
        .gte("starts_at", new Date(from).toISOString())
        .lt("starts_at", new Date(to).toISOString())
        .order("starts_at"),
    );
  } catch {
    throw new Error("Не удалось загрузить смены сотрудника");
  }
}

/**
 * Смены, которые управляющий при проверке выходов не засчитал
 * (`payroll_schedule_reviews`, решение `exclude`; запись без решения —
 * из времени до миграции 324 — зарплата тоже считает исключением).
 */
async function excludedShiftIds(venueId: string, shiftIds: string[]): Promise<Set<string>> {
  const db = asLooseDb(createAdminClient());
  const parts = await Promise.all(
    chunk(shiftIds, 200).map((ids) =>
      fetchAllRows(() =>
        db
          .from<{ shift_id: string }[]>("payroll_schedule_reviews")
          .select("shift_id")
          .eq("venue_id", venueId)
          .in("shift_id", ids)
          .or("decision.is.null,decision.eq.exclude"),
      ),
    ),
  );
  return new Set(parts.flat().map((r) => r.shift_id));
}

export type StaffMonthStats = {
  /** Первое число месяца, `YYYY-MM-DD`. */
  month: string;
  /** Нет права на график — null. */
  shifts: { done: number; upcoming: number; hours: number } | null;
  /** Нет права на зарплату или зарплатной карточки — undefined; не загрузилось — null.
   *  Пока часть статей считается, это сумма посчитанного (см. `pending`). */
  earned?: number | null;
  /** Статьи, суммы которых ещё считаются (id групп расчётного листа). */
  pending?: string[];
};

/**
 * Показатели шапки карточки за текущий месяц: смены по опубликованному
 * графику (право `schedule.view_all`) и «Начислено» (право `payroll.view`,
 * тот же расчёт, что вкладка «Оплата»). Права проверяет вызывающий.
 */
export async function loadStaffMonthStats(input: {
  venueId: string;
  userId: string;
  today: string;
  clock: VenueClock;
  canViewSchedule: boolean;
  canViewPayroll: boolean;
}): Promise<StaffMonthStats | null> {
  const { venueId, userId, today, clock, canViewSchedule, canViewPayroll } = input;
  if (!canViewSchedule && !canViewPayroll) return null;
  const month = `${today.slice(0, 7)}-01`;
  const lastDay = addDays(`${addDays(month, 32).slice(0, 7)}-01`, -1);
  const now = Date.now();
  const [shifts, earned] = await Promise.all([
    canViewSchedule
      ? publishedShifts(
          venueId,
          userId,
          dayWindow(month, clock.timezone, clock.dayStartHour).start,
          dayWindow(lastDay, clock.timezone, clock.dayStartHour).end,
        ).then((rows) => {
          let done = 0;
          let upcoming = 0;
          let hours = 0;
          for (const row of rows) {
            const start = Date.parse(row.starts_at);
            if (start > now) {
              upcoming += 1;
              continue;
            }
            done += 1;
            hours += (Math.min(Date.parse(row.ends_at), now) - start) / HOUR;
          }
          return { done, upcoming, hours: Math.round(hours * 10) / 10 };
        })
      : Promise.resolve(null),
    canViewPayroll
      ? employeeIds(venueId, userId).then(async (ids) => {
          // Не участвует в зарплатном учёте — показателя нет.
          if (!ids.length) return undefined;
          const db = asLooseDb(createAdminClient());
          try {
            const rows = await fetchAllRows(() =>
              db
                .from<Accrual[]>("payroll_accruals")
                .select("id, employee_id, business_date, components, calculation_snapshot")
                .eq("venue_id", venueId)
                .in("employee_id", ids)
                .gte("business_date", month)
                .lte("business_date", lastDay),
            );
            const sheet = buildPaySheet(rows, month, () => "");
            return { earned: sheet.earned, pending: sheet.pending };
          } catch {
            return { earned: null, pending: [] };
          }
        })
      : Promise.resolve(undefined),
  ]);
  return { month, shifts, ...(earned ?? {}) };
}

export type ShiftHeatmapData = {
  today: string;
  /** Часы по рабочим дням заведения. */
  hours: Record<string, number>;
};

/**
 * Часы смен сотрудника по дням за год — для тепловой карты во вкладке
 * «Активность». Отметки из кассы (право `payroll.view`) — факт и заменяют
 * график за свой день. За дни, которые зарплатный учёт уже сверил с кассой,
 * график не подставляется: засчитанные по графику смены там уже есть среди
 * отметок, а невыход — нет. Смены, которые управляющий не засчитал, не
 * считаются никогда. Права проверяет вызывающий.
 */
export async function loadShiftHeatmap(input: {
  venueId: string;
  userId: string;
  clock: VenueClock;
  canViewSchedule: boolean;
  canViewPayroll: boolean;
}): Promise<ShiftHeatmapData> {
  const { venueId, userId, clock, canViewSchedule, canViewPayroll } = input;
  const now = Date.now();
  const today = businessDate(new Date(now), clock.timezone, clock.dayStartHour);
  const from = heatmapStart(today);
  const dayOf = (iso: string) => businessDate(new Date(iso), clock.timezone, clock.dayStartHour);
  const db = asLooseDb(createAdminClient());
  const [planned, payroll] = await Promise.all([
    canViewSchedule
      ? publishedShifts(
          venueId,
          userId,
          dayWindow(from, clock.timezone, clock.dayStartHour).start,
          now,
        ).then(async (rows) => {
          const excluded = await excludedShiftIds(venueId, rows.map((r) => r.id));
          return rows
            .filter((r) => !excluded.has(r.id))
            .map((r) => ({
              date: dayOf(r.starts_at),
              hours: (Math.min(Date.parse(r.ends_at), now) - Date.parse(r.starts_at)) / HOUR,
            }));
        })
      : Promise.resolve([]),
    canViewPayroll
      ? employeeIds(venueId, userId).then(async (ids) => {
          if (!ids.length) return { marked: [], verified: new Set<string>() };
          const [marks, days, rules] = await Promise.all([
            fetchAllRows(() =>
              db
                .from<{ business_date: string; starts_at: string; ends_at: string | null }[]>(
                  "payroll_attendance",
                )
                .select("business_date, starts_at, ends_at")
                .eq("venue_id", venueId)
                .in("employee_id", ids)
                .gte("business_date", from)
                .lte("business_date", today)
                .neq("status", "ignored")
                .order("business_date"),
            ),
            // Не больше дня на дату — за год в окне меньше тысячи строк.
            db
              .from<{ business_date: string }[]>("payroll_source_days")
              .select("business_date")
              .eq("venue_id", venueId)
              .eq("state", "complete")
              .gte("business_date", from)
              .lte("business_date", today),
            fetchAllRows(() =>
              db
                .from<{ employee_id: string; valid_from: string; source: string }[]>(
                  "payroll_attendance_rules",
                )
                .select("employee_id, valid_from, source")
                .in("employee_id", ids)
                .order("valid_from")
                .order("created_at"),
            ),
          ]);
          if (days.error) throw new Error("Не удалось загрузить отметки сотрудника");
          // Сверка касается сотрудника, только если его выходы учитываются
          // (источник не «excluded» на этот день, по умолчанию — касса).
          const sourceOn = (employeeId: string, date: string) =>
            rules
              .filter((r) => r.employee_id === employeeId && r.valid_from <= date)
              .at(-1)?.source ?? "quickresto";
          const verified = new Set(
            (days.data ?? [])
              .map((d) => d.business_date)
              .filter((date) => ids.some((id) => sourceOn(id, date) !== "excluded")),
          );
          return {
            verified,
            marked: marks.map((m) => ({
              date: m.business_date,
              // Незакрытая отметка — до «сейчас», но не дольше 16 ч.
              hours:
                ((m.ends_at
                  ? Date.parse(m.ends_at)
                  : Math.min(now, Date.parse(m.starts_at) + OPEN_CLOCK_MAX_HOURS * HOUR)) -
                  Date.parse(m.starts_at)) /
                HOUR,
            })),
          };
        })
      : Promise.resolve({ marked: [], verified: new Set<string>() }),
  ]);
  return { today, hours: hoursByDay(planned, payroll.marked, payroll.verified) };
}
