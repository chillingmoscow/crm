"use server";
import { createClient, getCachedPermissions } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/types/database";
import type { ScheduleDatabase, ScheduleData } from "@/lib/schedule/types";
import { z } from "zod";
import { revalidatePath } from "next/cache";
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
const template = base.extend({
  name: z.string().trim().min(1).max(160),
  color,
  start_time: time,
  end_time: time,
  break_minutes: z.number().int().min(0).max(1439),
  arrival_minutes: z.number().int().min(0).max(240),
  department_id: nullable,
  role_id: nullable,
  checklist_ids: z.array(uuid).max(30),
});
const shift = base.extend({
  title: z.string().trim().min(1).max(160),
  color,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: time,
  end_time: time,
  break_minutes: z.number().int().min(0).max(1439),
  arrival_minutes: z.number().int().min(0).max(240),
  department_id: nullable,
  role_id: nullable,
  template_id: nullable,
  user_id: nullable,
  payroll_employee_id: nullable.optional(),
  payroll_model_id: nullable.optional(),
  casual_name: z.string().trim().max(160).optional(),
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
export async function loadSchedule(
  from?: string,
  to?: string,
): Promise<ScheduleData> {
  const db = await client();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new Error("Не авторизован");
  const { data: venueId } = await db.rpc("get_active_venue_id");
  if (!venueId) throw new Error("Выберите заведение");
  const permissions = await getCachedPermissions();
  let sq = db
    .from("schedule_shifts")
    .select("*")
    .eq("venue_id", venueId)
    .order("starts_at");
  if (from && to) sq = sq.gte("ends_at", from).lte("starts_at", to);
  const options = await db.rpc("schedule_payroll_options" as never);
  if (options.error) throw new Error(options.error.message);
  const payrollOptions = options.data as unknown as {
    employees: NonNullable<ScheduleData["casualEmployees"]>;
    models: NonNullable<ScheduleData["payModels"]>;
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
  ] = await Promise.all([
    sq,
    db
      .from("schedule_templates")
      .select("*")
      .eq("venue_id", venueId)
      .order("name"),
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
  ]);
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
  ])
    if (r.error)
      throw new Error("Не удалось загрузить график: " + r.error.message);
  return {
    venueId,
    timezone: venue.data?.timezone || "Europe/Moscow",
    userId: user.id,
    permissions,
    shifts: shifts.data ?? [],
    templates: templates.data ?? [],
    checklists: checklists.data ?? [],
    runs: runs.data ?? [],
    qualifications: qualifications.data ?? [],
    casualEmployees: payrollOptions.employees,
    payModels: payrollOptions.models,
    staff: (staff.data ?? []).map((s) => ({
      user_id: s.user_id,
      first_name: s.first_name,
      last_name: s.last_name,
      role_id: s.role_id,
      role_name: s.role_name,
      department_id: s.department_id,
    })),
    departments: departments.data ?? [],
    roles: roles.data ?? [],
  };
}
export async function scheduleCommand(
  action: string,
  input: unknown,
): Promise<{ id?: string; error?: string }> {
  try {
    let parsed: unknown;
    if (["shift.create", "shift.edit", "shift.copy"].includes(action))
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
    const { data, error } = await db.rpc("schedule_command", {
      p_action: action,
      p_input: parsed as Json,
    });
    if (error) return { error: error.message };
    revalidatePath("/schedule");
    return data as { id: string };
  } catch (e) {
    return {
      error:
        e instanceof z.ZodError
          ? "Проверьте поля: " + e.issues.map((i) => i.message).join(", ")
          : e instanceof Error
            ? e.message
            : "Не удалось сохранить",
    };
  }
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
  return error ? { error: error.message } : { path };
}
export async function evidenceUrl(path: string) {
  const db = await client();
  const { data, error } = await db.storage
    .from("schedule-evidence")
    .createSignedUrl(path, 600);
  if (error) return { error: error.message };
  return { url: data.signedUrl };
}
