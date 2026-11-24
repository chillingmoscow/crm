"use server";
import { createClient, getCachedActiveAccountId, getCachedPermissions, getCachedUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/types/database";
import type { CandidateCalendarTrial, ScheduleDatabase, ScheduleData, Shift } from "@/lib/schedule/types";
import { asLooseDb, type LooseQuery, type LooseResult } from "@/lib/supabase/loose";
import { swapCandidates, type ShiftSwap, type SwapPerson } from "@/lib/schedule/shift-swaps";
import { validateVariants } from "@/lib/schedule/template-times";
import type { ShiftAttendanceMark, ShiftAttendanceSnapshot } from "@/lib/payroll/types";
import { addDays, validDate } from "@/lib/sales/time";
import { applyShiftReviews } from "@/lib/payroll/shift-attendance";
import { dateInZone } from "@/lib/schedule/utils";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { mediaUrl } from "@/lib/storage/media";
import { actionErrorMessage, actionResult } from "@/lib/actions/result";
const uuid = z.string().uuid();
const nullable = uuid.nullable();
const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);
const color = z.enum([
  "gray",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
]);
const item = z.object({
  id: uuid,
  title: z.string().trim().min(1).max(300),
  hint: z.string().max(2000),
  kind: z.enum(["check", "photo", "number", "text", "info"]),
  required: z.boolean(),
  parent_id: nullable,
  min: z.number().nullable(),
  max: z.number().nullable(),
  unit: z.string().max(30),
  max_length: z.number().int().min(1).max(10000),
});
const base = z.object({
  id: uuid.optional(),
  version: z.number().int().positive().optional(),
});
const template = base
  .extend({
    name: z.string().trim().min(1).max(160),
    subtitle: z.string().trim().max(80).optional(),
    color,
    start_time: time,
    end_time: time,
    department_id: nullable,
    role_id: nullable,
    checklist_ids: z.array(uuid).max(30),
    // Отсутствует — при редактировании/копировании берутся варианты исходного шаблона.
    variants: z
      .array(
        z.object({
          days: z.array(z.number()),
          start_time: z.string(),
          end_time: z.string(),
        }),
      )
      .optional(),
  })
  .superRefine((x, ctx) => {
    const error = x.variants && validateVariants(x.variants);
    if (error)
      ctx.addIssue({ code: "custom", message: error, path: ["variants"] });
  });
const shift = base.extend({
  title: z.string().trim().min(1).max(160),
  color,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: time,
  end_time: time,
  department_id: nullable,
  role_id: nullable,
  template_id: nullable,
  user_id: nullable,
  payroll_employee_id: nullable.optional(),
  payroll_model_id: nullable.optional(),
  note: z.string().max(5000),
  checklist_ids: z.array(uuid).max(30),
});
const checklist = base
  .extend({
    name: z.string().trim().min(1).max(160),
    description: z.string().max(5000),
    kind: z.enum(["opening", "closing", "other"]),
    department_id: nullable,
    duration: z.number().int().min(0).max(1440),
    priority: z.enum(["low", "medium", "high"]),
    items: z.array(item).max(100),
  })
  .superRefine((x, ctx) => {
    const ids = new Set(x.items.map((i) => i.id));
    if (ids.size !== x.items.length)
      ctx.addIssue({ code: "custom", message: "Повторяющиеся пункты" });
    for (const i of x.items) {
      if (
        i.parent_id &&
        (!ids.has(i.parent_id) ||
          i.parent_id === i.id ||
          x.items.find((p) => p.id === i.parent_id)?.parent_id)
      )
        ctx.addIssue({
          code: "custom",
          message: "Допускается один уровень подпунктов",
        });
      if (i.min != null && i.max != null && i.min > i.max)
        ctx.addIssue({ code: "custom", message: "Минимум больше максимума" });
    }
  });
async function client() {
  return (await createClient()) as unknown as SupabaseClient<ScheduleDatabase>;
}
async function loadShiftAttendanceImpl(week: string): Promise<Record<string, ShiftAttendanceMark>> {
  if (!validDate(week)) throw new Error("Некорректная дата расписания");
  const db = await client();
  const [{ data: { user } }, { data: venueId }, accountId, permissions] =
    await Promise.all([
      db.auth.getUser(),
      db.rpc("get_active_venue_id"),
      getCachedActiveAccountId(),
      getCachedPermissions(),
    ]);
  if (!user || !venueId || !accountId ||
      !permissions.includes("payroll.view") ||
      !permissions.includes("schedule.view_all")) return {};

  const admin = asLooseDb(createAdminClient());
  const [{ data, error }, reviews] = await Promise.all([
    admin
      .from<{
        business_date: string;
        synced_at: string | null;
        state: string;
        missing_shifts: string[] | null;
        marks: Record<string, ShiftAttendanceSnapshot> | null;
      }[]>("payroll_source_days")
      .select("business_date,synced_at,state,missing_shifts:source->missing_shifts,marks:source->shift_attendance")
      .eq("account_id", accountId)
      .eq("venue_id", venueId)
      .gte("business_date", addDays(week, -1))
      .lte("business_date", addDays(week, 6)),
    admin
      .from<{ shift_id: string; decision: "include" | "exclude" | null; reason: string; reviewed_at: string }[]>(
        "payroll_schedule_reviews",
      )
      .select("shift_id,decision,reason,reviewed_at")
      .eq("account_id", accountId)
      .eq("venue_id", venueId)
      .gte("business_date", addDays(week, -1))
      .lte("business_date", addDays(week, 6)),
  ]);
  if (error || reviews.error) throw new Error("Не удалось загрузить отметки о выходах");
  const result: Record<string, ShiftAttendanceMark> = {};
  for (const day of data ?? []) {
    const context = { date: day.business_date, syncedAt: day.synced_at, sourceState: day.state };
    for (const id of day.missing_shifts ?? []) result[id] = { ...context, state: "missing" };
    for (const [id, mark] of Object.entries(day.marks ?? {})) result[id] = { ...context, ...mark };
  }
  return applyShiftReviews(result, reviews.data ?? []);
}
async function reviewShiftAttendanceImpl(input: {
  shiftId: string;
  version: number;
  syncedAt: string | null;
  decision: "include" | "exclude";
  reason: string;
}) {
  const value = z.object({
    shiftId: uuid,
    version: z.number().int().positive(),
    syncedAt: z.string().datetime({ offset: true }).nullable(),
    decision: z.enum(["include", "exclude"]),
    reason: z.string().trim().min(3).max(1000),
  }).parse(input);
  const db = await client();
  const { error } = await asLooseDb(db).rpc("payroll_review_schedule_shift", {
    p_shift: value.shiftId,
    p_version: value.version,
    p_synced_at: value.syncedAt,
    p_decision: value.decision,
    p_reason: value.reason,
  });
  if (error) throw new Error(error.message);
}
async function loadScheduleImpl(
  from?: string,
  to?: string,
): Promise<ScheduleData> {
  const db = await client();
  const [user, { data: venueId }, permissions] = await Promise.all([
    getCachedUser(),
    db.rpc("get_active_venue_id"),
    getCachedPermissions(),
  ]);
  if (!user) throw new Error("Не авторизован");
  if (!venueId) throw new Error("Выберите заведение");
  // Без права планирования таблица отдаёт только свои смены; остальную
  // команду — schedule_team_shifts(): опубликованные смены без заметок и
  // полей оплаты.
  const planner = permissions.includes("schedule.view_all");
  const loadTeam = async () => {
    const rows: TeamShiftRow[] = [];
    if (planner) return { data: rows, error: null };
    for (let start = 0; start < 20000; start += 1000) {
      let query = asLooseDb(db).rpc("schedule_team_shifts", {
        p_from: from && to ? from : null,
        p_to: from && to ? to : null,
      }) as unknown as LooseQuery<TeamShiftRow[]>;
      query = query.range(start, start + 999);
      const { data, error } = await query;
      if (error) return { data: null, error };
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < 1000) return { data: rows, error: null };
    }
    return { data: null, error: { message: "Слишком большая история смен" } };
  };
  const loadShifts = async () => {
    const rows: ScheduleData["shifts"] = [];
    for (let start = 0; start < 20000; start += 1000) {
      let query = db.from("schedule_shifts").select("*").eq("venue_id", venueId)
        .order("starts_at").order("id");
      if (from && to) query = query.gte("ends_at", from).lte("starts_at", to);
      const { data, error } = await query.range(start, start + 999);
      if (error) return { data: null, error };
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < 1000) return { data: rows, error: null };
    }
    return { data: null, error: { message: "Слишком большая история смен" } };
  };
  const [
    shifts,
    templates,
    checklists,
    runs,
    qualifications,
    staff,
    departments,
    roles,
    venue,
    candidateTrials,
    hiddenRoles,
    options,
    team,
    teamDepartments,
    swaps,
  ] = await Promise.all([
    loadShifts(),
    db
      .from("schedule_templates")
      .select("*")
      .eq("venue_id", venueId)
      .order("name").order("subtitle"),
    db
      .from("schedule_checklists")
      .select("*")
      .eq("venue_id", venueId)
      .order("name"),
    db
      .from("schedule_runs")
      .select("*")
      .eq("venue_id", venueId)
      .order("started_at", { ascending: false }),
    db.from("schedule_qualifications").select("*").eq("venue_id", venueId),
    db.rpc("get_venue_staff", { p_venue_id: venueId }),
    db
      .from("departments")
      .select("id,name")
      .eq("venue_id", venueId)
      .order("name"),
    db
      .from("roles")
      .select("id,name,department_id")
      .eq("venue_id", venueId)
      .order("name"),
    db.from("venues").select("timezone").eq("id", venueId).single(),
    permissions.includes("schedule.view_all")
      ? asLooseDb(db).rpc("candidate_calendar_trials", {})
      : Promise.resolve({ data: [], error: null }),
    asLooseDb(db).from<{ role_id: string }[]>("schedule_hidden_roles")
      .select("role_id").eq("venue_id", venueId),
    db.rpc("schedule_payroll_options" as never),
    loadTeam(),
    planner
      ? Promise.resolve({ data: [] as { id: string; name: string }[], error: null })
      : (asLooseDb(db).rpc("schedule_team_departments") as Promise<LooseResult<{ id: string; name: string }[]>>),
    asLooseDb(db)
      .from<ShiftSwap[]>("schedule_shift_swaps")
      .select(SWAP_COLUMNS)
      .eq("venue_id", venueId)
      .or(`status.eq.pending,updated_at.gte."${new Date(Date.now() - 30 * 86400000).toISOString()}"`)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (options.error) throw new Error(options.error.message);
  const payrollOptions = options.data as unknown as {
    employees: NonNullable<ScheduleData["casualEmployees"]>;
    models: NonNullable<ScheduleData["payModels"]>;
    same_department_rate_from?: string | null;
  };
  for (const r of [
    shifts,
    templates,
    checklists,
    runs,
    qualifications,
    staff,
    departments,
    roles,
    venue,
    candidateTrials,
    hiddenRoles,
    team,
    teamDepartments,
    swaps,
  ])
    if (r.error)
      throw new Error("Не удалось загрузить расписание: " + r.error.message);
  const hidden = new Set(hiddenRoles.data?.map((entry) => entry.role_id));
  const own = shifts.data ?? [];
  const ownIds = new Set(own.map((s) => s.id));
  const teamRows = (team.data ?? []).filter((row) => !ownIds.has(row.id));
  const teamCasual = new Map<string, NonNullable<ScheduleData["casualEmployees"]>[number]>();
  for (const row of teamRows)
    if (row.casual_id && !teamCasual.has(row.casual_id))
      teamCasual.set(row.casual_id, {
        id: row.casual_id,
        name: row.casual_name ?? "Разовый сотрудник",
        role_id: row.role_id ?? "",
        role_name: row.casual_role_name ?? "",
        model_id: null,
      });
  const departmentList = departments.data?.length ? departments.data : teamDepartments.data ?? [];
  return {
    venueId,
    timezone: venue.data?.timezone || "Europe/Moscow",
    userId: user.id,
    permissions,
    shifts: [...own, ...teamRows.map((row) => teamShift(row, venueId))].sort(
      (a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id),
    ),
    swaps: swaps.data ?? [],
    candidateTrials: (candidateTrials.data ?? []) as CandidateCalendarTrial[],
    templates: templates.data ?? [],
    checklists: checklists.data ?? [],
    runs: runs.data ?? [],
    qualifications: qualifications.data ?? [],
    casualEmployees: planner ? payrollOptions.employees : [...teamCasual.values()],
    payModels: payrollOptions.models,
    sameDepartmentRateFrom: payrollOptions.same_department_rate_from ?? null,
    staff: (staff.data ?? []).map((s) => ({
      user_id: s.user_id,
      first_name: s.first_name,
      last_name: s.last_name,
      avatar_url: s.avatar_url,
      show_in_schedule: !hidden.has(s.role_id),
      role_id: s.role_id,
      role_name: s.role_name,
      department_id: s.department_id,
    })),
    departments: departmentList,
    roles: roles.data ?? [],
  };
}
type TeamShiftRow = {
  id: string;
  user_id: string | null;
  casual_id: string | null;
  casual_name: string | null;
  casual_role_name: string | null;
  role_id: string | null;
  department_id: string | null;
  title: string;
  color: string;
  starts_at: string;
  ends_at: string;
  version: number;
  updated_at: string;
};
/** Чужая опубликованная смена для сетки: служебные поля пустые. */
function teamShift(row: TeamShiftRow, venueId: string): Shift {
  return {
    id: row.id,
    venue_id: venueId,
    user_id: row.user_id,
    payroll_employee_id: row.casual_id,
    payroll_model_id: null,
    role_id: row.role_id,
    department_id: row.department_id,
    template_id: null,
    title: row.title,
    color: row.color,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    break_minutes: 0,
    arrival_minutes: 0,
    note: "",
    checklist_snapshots: {},
    checklist_ids: [],
    published: true,
    version: row.version,
    updated_at: row.updated_at,
  };
}
const SWAP_COLUMNS =
  "id,shift_id,from_user_id,to_user_id,comment,status,candidate_answer,candidate_answered_at,decided_by,decided_at,decision_comment,version,created_at";

export type SwapCandidate = {
  user_id: string;
  name: string;
  avatar_url: string | null;
  role_name: string;
};
/**
 * Кто может выйти вместо автора смены. Чужие допуски и смены в других
 * заведениях сотруднику не видны — читаем их сервисным клиентом, но только
 * после проверки, что смена его. Окончательная проверка — в RPC.
 */
async function loadSwapCandidatesImpl(shiftId: string): Promise<SwapCandidate[]> {
  if (!uuid.safeParse(shiftId).success) throw new Error("Смена не найдена");
  const db = await client();
  const [user, { data: venueId }] = await Promise.all([getCachedUser(), db.rpc("get_active_venue_id")]);
  if (!user || !venueId) throw new Error("Не авторизован");
  const { data: shift } = await db
    .from("schedule_shifts")
    .select("id,user_id,role_id,starts_at,ends_at,published")
    .eq("id", shiftId)
    .eq("venue_id", venueId)
    .maybeSingle();
  if (!shift || shift.user_id !== user.id) throw new Error("Замену можно предложить только для своей смены");
  const admin = asLooseDb(createAdminClient());
  const [staff, venue] = await Promise.all([
    db.rpc("get_venue_staff", { p_venue_id: venueId }),
    db.from("venues").select("timezone").eq("id", venueId).single(),
  ]);
  if (staff.error) throw new Error("Не удалось загрузить сотрудников");
  const people = new Map<string, SwapPerson & SwapCandidate>();
  for (const s of staff.data ?? []) {
    const person = people.get(s.user_id);
    if (person) {
      person.role_ids.push(s.role_id);
      if (s.role_id === shift.role_id) person.role_name = s.role_name;
    } else
      people.set(s.user_id, {
        user_id: s.user_id,
        role_ids: [s.role_id],
        name: [s.first_name, s.last_name].filter(Boolean).join(" ") || s.role_name,
        avatar_url: s.avatar_url,
        role_name: s.role_name,
      });
  }
  const ids = [...people.keys()];
  const around = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86400000).toISOString();
  const [qualifications, busy] = await Promise.all([
    shift.role_id
      ? admin
          .from<{ user_id: string; role_id: string }[]>("schedule_qualifications")
          .select("user_id,role_id")
          .eq("venue_id", venueId)
          .eq("role_id", shift.role_id)
      : Promise.resolve({ data: [], error: null }),
    admin
      .from<{ id: string; user_id: string | null; starts_at: string; ends_at: string }[]>("schedule_shifts")
      .select("id,user_id,starts_at,ends_at")
      .in("user_id", ids)
      .gte("ends_at", around(shift.starts_at, -2))
      .lte("starts_at", around(shift.ends_at, 2)),
  ]);
  if (qualifications.error || busy.error) throw new Error("Не удалось подобрать замену");
  return swapCandidates(shift, [...people.values()], {
    timezone: venue.data?.timezone || "Europe/Moscow",
    qualifications: qualifications.data ?? [],
    busy: busy.data ?? [],
  })
    .map(({ user_id, name, avatar_url, role_name }) => ({ user_id, name, avatar_url, role_name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

const swapInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("request"),
    shift_id: uuid,
    to_user_id: uuid,
    comment: z.string().trim().max(500),
  }),
  z.object({ action: z.literal("cancel"), id: uuid, version: z.number().int().positive() }),
  z.object({
    action: z.literal("respond"),
    id: uuid,
    version: z.number().int().positive(),
    answer: z.enum(["accepted", "declined"]),
  }),
  z.object({ action: z.literal("approve"), id: uuid, version: z.number().int().positive() }),
  z.object({
    action: z.literal("reject"),
    id: uuid,
    version: z.number().int().positive(),
    comment: z.string().trim().max(500),
  }),
]);
export type SwapCommandInput = z.input<typeof swapInput>;
/** Заявка на замену: создать, отозвать, ответить, утвердить, отклонить. */
export async function swapCommand(input: SwapCommandInput): Promise<{ error?: string }> {
  const parsed = swapInput.safeParse(input);
  if (!parsed.success) return { error: "Проверьте заявку" };
  const { action, ...rest } = parsed.data;
  const db = await client();
  const { error } = await asLooseDb(db).rpc("schedule_swap_command", { p_action: action, p_input: rest });
  if (error) return { error: actionErrorMessage(error, "Не удалось выполнить замену") };
  revalidatePath("/schedule");
  return {};
}
export async function scheduleCommand(
  action: string,
  input: unknown,
): Promise<{ id?: string; error?: string }> {
  try {
    let parsed: unknown;
    if (action === "shift.create_template_slot")
      parsed = z.object({
        template_id: uuid,
        template_version: z.number().int().positive(),
        date: z.string().refine(validDate),
        user_id: nullable,
        payroll_employee_id: nullable,
        payroll_model_id: nullable,
      }).parse(input);
    else if (["shift.create", "shift.edit", "shift.copy"].includes(action))
      parsed = shift.parse(input);
    else if (
      ["template.create", "template.edit", "template.copy"].includes(action)
    )
      parsed = template.parse(input);
    else if (["checklist.create", "checklist.edit"].includes(action))
      parsed = checklist.parse(input);
    else if (action === "shift.publish_many")
      parsed = z
        .object({
          shifts: z
            .array(z.object({ id: uuid, version: z.number().int().positive() }))
            .min(1)
            .max(300),
        })
        .parse(input);
    else if (action === "shift.assign")
      parsed = base
        .extend({
          id: uuid,
          version: z.number().int().positive(),
          user_id: nullable,
          payroll_employee_id: nullable.optional(),
          payroll_model_id: nullable.optional(),
        })
        .parse(input);
    else if (action === "run.start")
      parsed = z.object({ shift_id: uuid, checklist_id: uuid }).parse(input);
    else if (["run.save", "run.submit"].includes(action))
      parsed = base
        .extend({
          id: uuid,
          version: z.number().int().positive(),
          answers: z.record(
            z.union([
              z.boolean(),
              z.number().finite(),
              z.string().max(10000),
              z.null(),
            ]),
          ),
        })
        .parse(input);
    else if (["run.approve", "run.return"].includes(action))
      parsed = base
        .extend({
          id: uuid,
          version: z.number().int().positive(),
          comment: z.string().max(5000),
          notes: z.record(z.string().max(2000)).optional(),
        })
        .parse(input);
    else if (action === "qualification.save")
      parsed = z
        .object({ user_id: uuid, role_id: uuid, remove: z.boolean() })
        .parse(input);
    else
      parsed = base
        .extend({ id: uuid, version: z.number().int().positive() })
        .parse(input);
    const db = await client();
    const { data, error } = action === "shift.create_template_slot"
      ? await asLooseDb(db).rpc("schedule_create_template_slot", { p_input: parsed })
      : await db.rpc("schedule_command", { p_action: action, p_input: parsed as Json });
    if (error) return { error: actionErrorMessage(error, "Не удалось сохранить") };
    revalidatePath("/schedule");
    return data as { id: string };
  } catch (e) {
    return {
      error:
        e instanceof z.ZodError
          ? "Проверьте поля: " + e.issues.map((i) => i.message).join(", ")
          : actionErrorMessage(e, "Не удалось сохранить"),
    };
  }
}
export type ApplyTemplateResult = {
  updated: number;
  unchanged: number;
  skipped: { date: string; reason: string }[];
};
/** Переносит текущие значения шаблона в смены по нему, начиная с даты `from`. */
export async function applyTemplateToShifts(input: {
  id: string;
  from: string;
  previousTitle?: string;
}): Promise<ApplyTemplateResult | { error: string }> {
  const parsed = z
    .object({
      id: uuid,
      from: z.string().refine(validDate, "Укажите дату"),
      previousTitle: z.string().max(160).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Проверьте шаблон и дату" };
  const db = await client();
  const { data, error } = await asLooseDb(db).rpc(
    "schedule_apply_template",
    {
      p_template: parsed.data.id,
      p_from: parsed.data.from,
      p_previous_title: parsed.data.previousTitle ?? null,
    },
  );
  if (error || !data) return { error: actionErrorMessage(error, "Не удалось обновить смены") };
  revalidatePath("/schedule");
  return data as ApplyTemplateResult;
}
/** Сколько смен по шаблону начинается с даты (по часам заведения) — для окна «Обновить смены». */
async function countTemplateShiftsImpl(input: { id: string; from: string }): Promise<number> {
  const parsed = z.object({ id: uuid, from: z.string().refine(validDate) }).safeParse(input);
  if (!parsed.success) throw new Error("Проверьте шаблон и дату");
  const db = await client();
  const { data: venueId } = await db.rpc("get_active_venue_id");
  if (!venueId) throw new Error("Выберите заведение");
  const venue = await db.from("venues").select("timezone").eq("id", venueId).single();
  const timezone = venue.data?.timezone || "Europe/Moscow";
  // Запас в сутки на часовой пояс, точная граница — по дате заведения.
  const { data, error } = await db
    .from("schedule_shifts")
    .select("starts_at")
    .eq("venue_id", venueId)
    .eq("template_id", parsed.data.id)
    .gte("starts_at", `${addDays(parsed.data.from, -1)}T00:00:00Z`);
  if (error) throw new Error("Не удалось посчитать смены");
  return (data ?? []).filter((s) => dateInZone(s.starts_at, timezone) >= parsed.data.from).length;
}
export async function scheduleHistory(id: string) {
  const db = await client();
  const { data, error } = await db
    .from("schedule_events")
    .select("*")
    .eq("entity_id", id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}
/**
 * История смены по страницам: от новых к старым. Курсор — (created_at, id)
 * последней загруженной записи: события одной транзакции делят created_at,
 * и курсор только по времени терял бы их на границе страниц.
 */
async function shiftHistoryPageImpl(id: string, before?: { created_at: string; id: string }) {
  if (!uuid.safeParse(id).success) throw new Error("Смена не найдена");
  if (before && (!uuid.safeParse(before.id).success || Number.isNaN(Date.parse(before.created_at))))
    throw new Error("Некорректная страница истории");
  const pageSize = 20;
  const db = await client();
  let query = db
    .from("schedule_events")
    .select("*")
    .eq("entity_id", id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1);
  if (before)
    query = query.or(
      `created_at.lt."${before.created_at}",and(created_at.eq."${before.created_at}",id.lt.${before.id})`,
    );
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return { events: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}
export async function uploadEvidence(runId: string, form: FormData) {
  const parsed = uuid.safeParse(runId);
  const file = form.get("file");
  if (
    !parsed.success ||
    !(file instanceof File) ||
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    return { error: "Выберите JPG, PNG или WebP до 10 МБ" };
  const db = await client();
  const path = `${runId}/${crypto.randomUUID()}.${file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp"}`;
  const { error } = await db.storage
    .from("schedule-evidence")
    .upload(path, file, { contentType: file.type });
  return error ? { error: actionErrorMessage(error, "Не удалось загрузить файл") } : { path };
}
export async function evidenceUrl(path: string) {
  const db = await client();
  // Короткая подпись — только проверка, что фото есть и доступно; показываем
  // его постоянным адресом, чтобы браузер держал фото месяц.
  const { error } = await db.storage
    .from("schedule-evidence")
    .createSignedUrl(path, 60);
  if (error) return { error: actionErrorMessage(error, "Не удалось открыть файл") };
  return { url: mediaUrl("schedule-evidence", path) };
}

// Действия возвращают ошибку текстом, а не исключением: в рабочей сборке Next.js заменяет текст брошенного исключения английской заглушкой (см. lib/actions/result).
export async function loadShiftAttendance(week: string) {
  return actionResult(() => loadShiftAttendanceImpl(week), "Не удалось загрузить отметки о выходах");
}
export async function reviewShiftAttendance(input: Parameters<typeof reviewShiftAttendanceImpl>[0]) {
  return actionResult(() => reviewShiftAttendanceImpl(input), "Не удалось сохранить решение");
}
export async function loadSchedule(from?: string, to?: string) {
  return actionResult(() => loadScheduleImpl(from, to), "Не удалось загрузить расписание");
}
export async function loadSwapCandidates(shiftId: string) {
  return actionResult(() => loadSwapCandidatesImpl(shiftId), "Не удалось подобрать замену");
}
export async function countTemplateShifts(input: { id: string; from: string }) {
  return actionResult(() => countTemplateShiftsImpl(input), "Не удалось посчитать смены");
}
export async function shiftHistoryPage(id: string, before?: { created_at: string; id: string }) {
  return actionResult(() => shiftHistoryPageImpl(id, before), "Не удалось загрузить историю");
}
