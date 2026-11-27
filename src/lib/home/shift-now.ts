import "server-only";

import { dayWindow } from "@/lib/sales/time";
import { effectiveMetrics, type DayStatus, type SalesDay } from "@/lib/sales/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";

import { getHomeContext } from "./context";

export type ShiftPerson = {
  shiftId: string;
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  role: string | null;
  startsAt: string;
  endsAt: string;
  /**
   * Отметка Quick Resto: `true` — отметился, `false` — смена началась, а
   * отметки нет, `null` — не знаем (смена ещё не началась, нет права на
   * отметки или данные за день ещё не пришли).
   */
  checkedIn: boolean | null;
};

export type ShiftNow = {
  businessDay: string;
  timezone: string;
  /** Кто на смене сегодня; `null` — блок команды не показываем (нет права). */
  team: ShiftPerson[] | null;
  /** Отметки за день: `null` — нет права; `syncedAt: null` — данных ещё нет. */
  attendance: { syncedAt: string | null } | null;
  /** Оборот смены; `null` — нет права на смены продаж. */
  turnover: { value: number | null; status: DayStatus | null; syncedAt: string | null } | null;
  /** Когда собраны эти данные (ISO). */
  loadedAt: string;
};

type TeamRow = {
  id: string;
  user_id: string | null;
  casual_name: string | null;
  casual_role_name: string | null;
  title: string | null;
  starts_at: string;
  ends_at: string;
};
type StaffRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  role_name: string | null;
};

/** Видит ли человек блок «Смена сейчас»: команду (планирование) или оборот. */
export function canSeeShiftNow(permissions: Set<string>): boolean {
  return permissions.has("schedule.view_all") || permissions.has("sales.view_shifts");
}

/**
 * «Смена сейчас» на главной: кто сегодня на смене по опубликованному графику,
 * кто из начавших смену не отметился в Quick Resto и оборот открытой смены.
 * Каждая часть — по своему праву; запросы идут параллельно. Отказ одной
 * части бросает исключение — блок покажет «не удалось загрузить», а
 * автообновление — «не удалось обновить», не выдавая старое за новое.
 */
export async function loadShiftNow(): Promise<ShiftNow | null> {
  const ctx = await getHomeContext();
  if (!ctx) return null;
  const can = (code: string) => ctx.permissions.has(code);
  const supabase = await createClient();
  const db = asLooseDb(supabase);
  const window = dayWindow(ctx.businessDay, ctx.timezone, ctx.dayStartHour);
  const from = new Date(window.start).toISOString();
  const to = new Date(window.end).toISOString();
  const seeTeam = can("schedule.view_all");
  const seeMarks = seeTeam && can("payroll.view");

  const [team, staff, marks, source, sales] = await Promise.all([
    seeTeam
      ? (db.rpc("schedule_team_shifts", { p_from: from, p_to: to }) as Promise<{
          data: TeamRow[] | null;
          error: { message: string } | null;
        }>)
      : null,
    seeTeam
      ? (db.rpc("get_venue_staff", { p_venue_id: ctx.venueId }) as Promise<{
          data: StaffRow[] | null;
          error: { message: string } | null;
        }>)
      : null,
    seeMarks
      ? db
          .from<{ shift_id: string | null; employee_id: string | null; status: string }[]>("payroll_attendance")
          .select("shift_id,employee_id,status")
          .eq("venue_id", ctx.venueId)
          .eq("business_date", ctx.businessDay)
          .limit(1000)
      : null,
    // Состояние источника за день читается только сервером (как в
    // «Расписании»); право на отметки проверено выше.
    seeMarks
      ? asLooseDb(createAdminClient())
          .from<{ synced_at: string | null }>("payroll_source_days")
          .select("synced_at")
          .eq("account_id", ctx.accountId)
          .eq("venue_id", ctx.venueId)
          .eq("business_date", ctx.businessDay)
          .maybeSingle()
      : null,
    can("sales.view_shifts")
      ? db
          .from<Pick<SalesDay, "status" | "calculated" | "overrides" | "synced_at">>("sales_days")
          .select("status,calculated,overrides,synced_at")
          .eq("venue_id", ctx.venueId)
          .eq("business_date", ctx.businessDay)
          .maybeSingle()
      : null,
  ]);
  for (const r of [team, staff, marks, source, sales]) if (r?.error) throw new Error(r.error.message);

  let people: ShiftPerson[] | null = null;
  if (team) {
    const byUser = new Map((staff?.data ?? []).map((s) => [s.user_id, s]));
    // Отметка привязана к смене (`shift_id`), а если сверка её не связала —
    // к сотруднику Quick Resto; его карточку в приложении ищем по связке.
    const checkedShifts = new Set<string>();
    const checkedEmployees = new Set<string>();
    for (const m of marks?.data ?? []) {
      if (m.status === "ignored") continue;
      if (m.shift_id) checkedShifts.add(m.shift_id);
      if (m.employee_id) checkedEmployees.add(m.employee_id);
    }
    const employeeUsers = await employeeUserIds(db, ctx.venueId, [...checkedEmployees]);
    const now = Date.now();
    const synced = !!source?.data?.synced_at;
    people = (team.data ?? [])
      // Смена этого рабочего дня — та, что в нём начинается.
      .filter((s) => {
        const start = Date.parse(s.starts_at);
        return start >= window.start && start < window.end;
      })
      .map((s) => {
        const person = s.user_id ? byUser.get(s.user_id) : undefined;
        const name = person
          ? [person.first_name, person.last_name].filter(Boolean).join(" ") || "Сотрудник"
          : (s.casual_name ?? s.title ?? "Без сотрудника");
        const started = Date.parse(s.starts_at) <= now;
        const checked =
          checkedShifts.has(s.id) || (!!s.user_id && employeeUsers.has(s.user_id));
        return {
          shiftId: s.id,
          userId: s.user_id,
          name,
          avatarUrl: person?.avatar_url ?? null,
          role: person?.role_name ?? s.casual_role_name ?? null,
          startsAt: s.starts_at,
          endsAt: s.ends_at,
          checkedIn: !seeMarks || !started ? null : checked ? true : synced ? false : null,
        };
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.name.localeCompare(b.name, "ru"));
  }

  return {
    businessDay: ctx.businessDay,
    timezone: ctx.timezone,
    team: people,
    attendance: seeMarks ? { syncedAt: source?.data?.synced_at ?? null } : null,
    turnover: sales
      ? {
          value: sales.data ? effectiveMetrics(sales.data).turnover : null,
          status: sales.data?.status ?? null,
          syncedAt: sales.data?.synced_at ?? null,
        }
      : null,
    loadedAt: new Date().toISOString(),
  };
}

/** Пользователи приложения за сотрудниками ведомости (связка с Quick Resto). */
async function employeeUserIds(
  db: ReturnType<typeof asLooseDb>,
  venueId: string,
  employeeIds: string[],
): Promise<Set<string>> {
  if (!employeeIds.length) return new Set();
  const { data, error } = await db
    .from<{ local_user_id: string | null }[]>("payroll_employees")
    .select("local_user_id")
    .eq("venue_id", venueId)
    .in("id", employeeIds.slice(0, 200));
  if (error) throw new Error(error.message);
  return new Set((data ?? []).flatMap((e) => (e.local_user_id ? [e.local_user_id] : [])));
}
