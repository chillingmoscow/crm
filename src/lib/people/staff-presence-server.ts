import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { chunk } from "@/lib/supabase/fetch-all";
import {
  OPEN_CLOCK_MAX_HOURS,
  onShiftNow,
  type PresenceClock,
  type PresenceShift,
} from "./staff-activity";

/**
 * Кто сейчас на смене в заведении — для точки на аватаре в «Сотрудниках» и
 * в карточке. Источник — опубликованный график (его видит любой сотрудник
 * заведения, `schedule_team_shifts`) и отметки прихода из кассы. Сами
 * отметки наружу не уходят: только «на смене / нет». Читаем service-role,
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
    let employeesQuery = admin
      .from<{ id: string; local_user_id: string | null }[]>("payroll_employees")
      .select("id, local_user_id")
      .eq("venue_id", venueId);
    if (onlyUserId) employeesQuery = employeesQuery.eq("local_user_id", onlyUserId);
    const [shifts, employees] = await Promise.all([shiftsQuery, employeesQuery]);
    if (shifts.error || employees.error) return empty;
    const userOf = new Map<string, string | null>(
      (employees.data ?? []).map((e: { id: string; local_user_id: string | null }) => [e.id, e.local_user_id]),
    );
    // Отметки за последние 16 часов: открытые и закрытые (ушёл раньше).
    const ids = onlyUserId ? [...userOf.keys()] : null;
    if (ids && ids.length === 0 && !(shifts.data ?? []).length) return empty;
    const clockRows: { employee_id: string | null; starts_at: string; ends_at: string | null }[] = [];
    const clockQuery = () =>
      admin
        .from<typeof clockRows>("payroll_attendance")
        .select("employee_id, starts_at, ends_at")
        .eq("venue_id", venueId)
        .gte("starts_at", since)
        .neq("status", "ignored");
    if (ids) {
      for (const part of chunk(ids, 100)) {
        const { data, error } = await clockQuery().in("employee_id", part);
        if (error) return empty;
        clockRows.push(...(data ?? []));
      }
    } else {
      const { data, error } = await clockQuery();
      if (error) return empty;
      clockRows.push(...(data ?? []));
    }
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
