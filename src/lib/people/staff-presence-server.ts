import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { chunk, fetchAllRows } from "@/lib/supabase/fetch-all";
import {
  OPEN_CLOCK_MAX_HOURS,
  onShiftNow,
  type PresenceClock,
  type PresenceShift,
} from "./staff-activity";

/**
 * Кто сейчас на смене в заведении — для точки на аватаре в «Сотрудниках» и
 * в карточке. Источник — опубликованный график (его видит любой сотрудник
 * заведения, `schedule_team_shifts`) и открытые отметки прихода из кассы
 * (правило — `onShiftNow`). Сами отметки наружу не уходят: только «на смене
 * / нет». Читаем service-role,
 * потому что страница уже закрыта правом `people.view_staff`.
 *
 * `userIds` — сотрудники Sheerly, `employeeIds` — зарплатные карточки
 * (по ним видно разовых без аккаунта). Ошибка чтения — пустой ответ: точка
 * необязательна и не должна ронять страницу.
 */
export async function loadOnShift(
  venueId: string,
  onlyUserId?: string,
): Promise<{ userIds: string[]; employeeIds: string[] }> {
  const empty = { userIds: [], employeeIds: [] };
  try {
    const admin = asLooseDb(createAdminClient());
    const now = Date.now();
    const iso = new Date(now).toISOString();
    const since = new Date(now - OPEN_CLOCK_MAX_HOURS * 3_600_000).toISOString();
    let shiftsQuery = admin
      .from<PresenceShift[]>("schedule_shifts")
      .select("user_id, payroll_employee_id, starts_at, ends_at")
      .eq("venue_id", venueId)
      .eq("published", true)
      .lte("starts_at", iso)
      .gte("ends_at", iso);
    if (onlyUserId) shiftsQuery = shiftsQuery.eq("user_id", onlyUserId);
    type Employee = { id: string; local_user_id: string | null };
    type ClockRow = { employee_id: string | null; starts_at: string; ends_at: string | null };
    // Открытые отметки за последние 16 часов: закрытые со смены не снимают.
    const clockQuery = () =>
      admin
        .from<ClockRow[]>("payroll_attendance")
        .select("employee_id, starts_at, ends_at")
        .eq("venue_id", venueId)
        .gte("starts_at", since)
        .is("ends_at", null)
        .neq("status", "ignored");
    const employeesByIds = async (ids: string[]) =>
      (
        await Promise.all(
          chunk(ids, 100).map(async (part) => {
            const { data, error } = await admin
              .from<Employee[]>("payroll_employees")
              .select("id, local_user_id")
              .eq("venue_id", venueId)
              .in("id", part);
            if (error) throw new Error(error.message);
            return data ?? [];
          }),
        )
      ).flat();
    let employees: Employee[];
    let clockRows: ClockRow[];
    const shifts = await shiftsQuery;
    if (shifts.error) return empty;
    if (onlyUserId) {
      // Одна карточка: зарплатные карточки этого человека, потом их отметки.
      const own = await admin
        .from<Employee[]>("payroll_employees")
        .select("id, local_user_id")
        .eq("venue_id", venueId)
        .eq("local_user_id", onlyUserId);
      if (own.error) return empty;
      employees = own.data ?? [];
      const ids = employees.map((e) => e.id);
      clockRows = ids.length
        ? await fetchAllRows(() => clockQuery().in("employee_id", ids))
        : [];
    } else {
      // Всё заведение: сначала открытые отметки за 16 часов, потом только те
      // зарплатные карточки, что в них встречаются.
      clockRows = await fetchAllRows(clockQuery);
      employees = await employeesByIds([
        ...new Set(clockRows.flatMap((c) => (c.employee_id ? [c.employee_id] : []))),
      ]);
    }
    const userOf = new Map(employees.map((e) => [e.id, e.local_user_id]));
    const clocks: PresenceClock[] = clockRows.map((c) => ({
      ...c,
      user_id: c.employee_id ? userOf.get(c.employee_id) ?? null : null,
    }));
    return onShiftNow(now, shifts.data ?? [], clocks);
  } catch (error) {
    console.error("on-shift unavailable:", error instanceof Error ? error.message : error);
    return empty;
  }
}
