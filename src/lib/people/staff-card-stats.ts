import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { addDays, businessDate, dayWindow } from "@/lib/sales/time";
import { buildPaySheet } from "@/lib/payroll/pay-sheet";
import type { Accrual } from "@/lib/payroll/types";
import { OPEN_CLOCK_MAX_HOURS, heatmapStart, hoursByDay } from "./staff-activity";

/** Часовой пояс и начало рабочего дня заведения. */
export type VenueClock = { timezone: string; dayStartHour: number };

type ShiftRow = { starts_at: string; ends_at: string };

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
  const { data, error } = await asLooseDb(createAdminClient())
    .from<ShiftRow[]>("schedule_shifts")
    .select("starts_at, ends_at")
    .eq("venue_id", venueId)
    .eq("user_id", userId)
    .eq("published", true)
    .gte("starts_at", new Date(from).toISOString())
    .lt("starts_at", new Date(to).toISOString())
    .order("starts_at")
    .limit(1000);
  if (error) throw new Error("Не удалось загрузить смены сотрудника");
  return data ?? [];
}

export type StaffMonthStats = {
  /** Первое число месяца, `YYYY-MM-DD`. */
  month: string;
  /** Нет права на график — null. */
  shifts: { done: number; upcoming: number; hours: number } | null;
  /** Нет права на зарплату или зарплатной карточки — undefined; сумма неизвестна — null. */
  earned?: number | null;
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
          const { data, error } = await asLooseDb(createAdminClient())
            .from<Accrual[]>("payroll_accruals")
            .select("id, employee_id, business_date, components, calculation_snapshot")
            .eq("venue_id", venueId)
            .in("employee_id", ids)
            .gte("business_date", month)
            .lte("business_date", lastDay)
            .limit(1000);
          if (error) return null;
          return buildPaySheet(data ?? [], month, () => "").earned;
        })
      : Promise.resolve(undefined),
  ]);
  return { month, shifts, ...(earned !== undefined ? { earned } : {}) };
}

export type ShiftHeatmapData = {
  today: string;
  /** Часы по рабочим дням заведения. */
  hours: Record<string, number>;
};

/**
 * Часы смен сотрудника по дням за год — для тепловой карты во вкладке
 * «Активность». Отметки из кассы (право `payroll.view`) — факт и заменяют
 * график за свой день; без отметок считаются опубликованные смены (право
 * `schedule.view_all`). Права проверяет вызывающий.
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
  const [planned, marked] = await Promise.all([
    canViewSchedule
      ? publishedShifts(
          venueId,
          userId,
          dayWindow(from, clock.timezone, clock.dayStartHour).start,
          now,
        ).then((rows) =>
          rows.map((r) => ({
            date: dayOf(r.starts_at),
            hours: (Math.min(Date.parse(r.ends_at), now) - Date.parse(r.starts_at)) / HOUR,
          })),
        )
      : Promise.resolve([]),
    canViewPayroll
      ? employeeIds(venueId, userId).then(async (ids) => {
          if (!ids.length) return [];
          const { data, error } = await asLooseDb(createAdminClient())
            .from<{ business_date: string; starts_at: string; ends_at: string | null; status: string }[]>(
              "payroll_attendance",
            )
            .select("business_date, starts_at, ends_at, status")
            .eq("venue_id", venueId)
            .in("employee_id", ids)
            .gte("business_date", from)
            .lte("business_date", today)
            .neq("status", "ignored")
            .limit(1000);
          if (error) throw new Error("Не удалось загрузить отметки сотрудника");
          // «Не пришёл» — день с отметкой без часов: график за него не считаем.
          return (data ?? []).map((m) => ({
            date: m.business_date,
            hours:
              m.status === "missing"
                ? 0
                : // Незакрытая отметка — до «сейчас», но не дольше 16 ч.
                  ((m.ends_at
                    ? Date.parse(m.ends_at)
                    : Math.min(now, Date.parse(m.starts_at) + OPEN_CLOCK_MAX_HOURS * HOUR)) -
                    Date.parse(m.starts_at)) /
                  HOUR,
          }));
        })
      : Promise.resolve([]),
  ]);
  return { today, hours: hoursByDay(planned, marked) };
}
