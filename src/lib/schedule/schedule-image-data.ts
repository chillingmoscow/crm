import "server-only";
import { z } from "zod";
import { createClient, getCachedActiveAccountId, getCachedPermissions, getCachedUser } from "@/lib/supabase/server";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import { addDays, weekStart } from "./utils";
import { buildScheduleImage, NO_DEPARTMENT, type ImageShift, type ScheduleImage } from "./schedule-image";

/**
 * Данные для картинки расписания. Читается под пользователем (RLS), а не
 * сервисным ключом: в картинку попадает только то, что человек и так видит.
 * Скачивать и отправлять картинку может тот, кто планирует график
 * (`schedule.view_all`); отправка в чат — ещё и с правом публиковать смены:
 * сообщение в общий чат и есть публикация графика.
 */
export const scheduleImageRequest = z.object({
  week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Некорректная неделя"),
  department: z.union([z.string().uuid(), z.literal(NO_DEPARTMENT)]).nullable().default(null),
});
export type ScheduleImageRequest = z.input<typeof scheduleImageRequest>;

export type ScheduleImageScope = {
  db: LooseDb;
  accountId: string;
  venueId: string;
  canSend: boolean;
};

export async function scheduleImageScope(): Promise<ScheduleImageScope> {
  const [user, accountId, permissions, client] = await Promise.all([
    getCachedUser(),
    getCachedActiveAccountId(),
    getCachedPermissions(),
    createClient(),
  ]);
  if (!user) throw new Error("Не авторизован");
  if (!accountId || !permissions.includes("schedule.view_all"))
    throw new Error("Картинку расписания может сделать тот, кто планирует график");
  const db = asLooseDb(client);
  const venue = await db.rpc("get_active_venue_id");
  if (venue.error) throw new Error(venue.error.message);
  if (!venue.data) throw new Error("Выберите заведение");
  return {
    db,
    accountId,
    venueId: venue.data as string,
    canSend: permissions.includes("schedule.shift_publish"),
  };
}

const ok = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`Не удалось загрузить ${what}: ${r.error.message}`);
  return r.data as T;
};

export async function loadScheduleImage(
  scope: ScheduleImageScope,
  request: ScheduleImageRequest,
): Promise<ScheduleImage> {
  const { week: rawWeek, department } = scheduleImageRequest.parse(request);
  const week = weekStart(rawWeek);
  const { db, venueId } = scope;
  // С запасом в сутки по краям: точная неделя считается по часам заведения.
  const from = `${addDays(week, -1)}T00:00:00Z`;
  const to = `${addDays(week, 8)}T00:00:00Z`;
  const [venue, shifts, templates, staff, options, departments, roles] = await Promise.all([
    db.from<{ name: string; timezone: string | null }>("venues").select("name,timezone").eq("id", venueId).single(),
    db
      .from<ImageShift[]>("schedule_shifts")
      .select("id,published,starts_at,ends_at,user_id,payroll_employee_id,department_id,role_id,template_id,color")
      .eq("venue_id", venueId)
      .eq("published", true)
      .gte("starts_at", from)
      .lt("starts_at", to)
      .order("starts_at")
      .limit(5000),
    db.from<{ id: string; color: string }[]>("schedule_templates").select("id,color").eq("venue_id", venueId),
    db.rpc("get_venue_staff", { p_venue_id: venueId }),
    db.rpc("schedule_payroll_options"),
    db.from<{ id: string; name: string }[]>("departments").select("id,name").eq("venue_id", venueId),
    db.from<{ id: string; name: string }[]>("roles").select("id,name").eq("venue_id", venueId),
  ]);
  const venueRow = ok(venue, "заведение");
  const staffRows = (ok(staff, "сотрудников") ?? []) as {
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    role_name: string;
  }[];
  const casual = ((ok(options, "разовых сотрудников") as { employees?: { id: string; name: string; role_name: string }[] } | null)
    ?.employees ?? []);
  return buildScheduleImage({
    venueName: venueRow.name,
    timezone: venueRow.timezone || "Europe/Moscow",
    week,
    department,
    shifts: ok(shifts, "смены") ?? [],
    people: [
      ...staffRows.map((s) => ({
        key: s.user_id,
        name: [s.first_name, s.last_name].filter(Boolean).join(" "),
        role: s.role_name,
      })),
      ...casual.map((e) => ({ key: `payroll:${e.id}`, name: e.name, role: `${e.role_name} · разовый` })),
    ],
    departments: ok(departments, "подразделения") ?? [],
    roles: ok(roles, "должности") ?? [],
    templateColors: Object.fromEntries((ok(templates, "шаблоны") ?? []).map((t) => [t.id, t.color])),
  });
}
