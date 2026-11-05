"use server";
import { createClient, getCachedPermissions } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDays, dateInZone } from "@/lib/schedule/utils";
import {
  taskDefinitionSchema,
  type TaskData,
  type TaskDefinition,
  type TaskOccurrence,
  type TaskSettings,
  type TaskMessage,
  type TaskPreview,
} from "@/lib/schedule/tasks";

async function context() {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error("Войдите в аккаунт");
  const db = asLooseDb(client);
  const venue = await db.rpc("get_active_venue_id");
  if (venue.error || !venue.data) throw new Error("Выберите заведение");
  return { client, db, user, venueId: String(venue.data) };
}
export async function loadTasks(): Promise<TaskData> {
  const { db, user, venueId } = await context();
  const venue = await db
    .from<{ timezone: string }>("venues")
    .select("timezone")
    .eq("id", venueId)
    .single();
  if (venue.error) throw new Error("Не удалось загрузить заведение");
  const timezone = venue.data?.timezone || "Europe/Moscow",
    today = dateInZone(new Date(), timezone);
  const permissions = await getCachedPermissions();
  const results = await Promise.all([
    db
      .from<TaskDefinition[]>("schedule_task_definitions")
      .select("*")
      .eq("venue_id", venueId)
      .order("name"),
    db
      .from<TaskOccurrence[]>("schedule_task_occurrences")
      .select("*")
      .eq("venue_id", venueId)
      .or(`business_date.gte.${addDays(today, -31)},settled_at.is.null`)
      .lte("business_date", addDays(today, 14))
      .order("business_date"),
    db
      .from<TaskSettings>("schedule_task_settings")
      .select("*")
      .eq("venue_id", venueId)
      .maybeSingle(),
    db
      .from<{ id: string; name: string }[]>("schedule_templates")
      .select("id,name")
      .eq("venue_id", venueId)
      .eq("archived", false)
      .order("name"),
    db
      .from<TaskMessage[]>("schedule_task_messages")
      .select("id,kind,business_date,chat_id,state,error")
      .eq("venue_id", venueId)
      .in("state", ["error", "review"])
      .order("business_date", { ascending: false })
      .limit(50),
  ]);
  for (const r of results)
    if (r.error)
      throw new Error("Не удалось загрузить задачи: " + r.error.message);
  return {
    definitions: results[0].data ?? [],
    occurrences: results[1].data ?? [],
    settings: results[2].data,
    templates: results[3].data ?? [],
    messages: results[4].data ?? [],
    permissions,
    userId: user.id,
    today,
    timezone,
  };
}
export async function saveTask(input: unknown) {
  try {
    const value = taskDefinitionSchema.parse(input);
    const { db } = await context();
    const result = await db.rpc("schedule_task_command", {
      p_action: "definition.save",
      p_input: value,
    });
    if (result.error) throw new Error(result.error.message);
    revalidatePath("/schedule/tasks");
    return {
      ok: true,
      existing: !!(result.data as { existing?: boolean } | null)?.existing,
    };
  } catch (e) {
    return {
      error:
        e instanceof z.ZodError
          ? e.issues[0]?.message
          : e instanceof Error
            ? e.message
            : "Не удалось сохранить задачу",
    };
  }
}
export async function saveTaskSettings(input: unknown) {
  try {
    const value = z
      .object({
        version: z.number().int().positive().optional(),
        enabled_from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
        legacy_stopped: z.boolean(),
        chat_id: z
          .string()
          .regex(/^-?\d{1,20}$/)
          .nullable(),
        reminder_chat_ids: z.array(z.string().regex(/^-?\d{1,20}$/)).max(30),
      })
      .parse(input);
    const { db } = await context();
    const result = await db.rpc("schedule_task_command", {
      p_action: "settings.save",
      p_input: value,
    });
    if (result.error) throw new Error(result.error.message);
    revalidatePath("/schedule/tasks");
    return { ok: true };
  } catch (e) {
    return {
      error:
        e instanceof z.ZodError
          ? "Проверьте дату и ID чатов"
          : e instanceof Error
            ? e.message
            : "Не удалось сохранить настройки",
    };
  }
}
export async function taskRunCommand(action: string, input: unknown) {
  try {
    z.enum(["run.save", "run.submit", "run.approve", "run.return"]).parse(
      action,
    );
    const value = z
      .object({
        id: z.string().uuid(),
        version: z.number().int().positive(),
        answers: z
          .record(
            z.union([
              z.boolean(),
              z.string().max(15000),
              z.number().finite(),
              z.null(),
            ]),
          )
          .optional(),
        comment: z.string().max(5000).optional(),
        correct_until: z.string().datetime().optional(),
      })
      .parse(input);
    const { db } = await context();
    const r = await db.rpc("schedule_task_command", {
      p_action: action,
      p_input: value,
    });
    if (r.error) throw new Error(r.error.message);
    revalidatePath("/schedule/tasks");
    return { ok: true };
  } catch (e) {
    return {
      error:
        e instanceof z.ZodError
          ? "Проверьте ответы"
          : e instanceof Error
            ? e.message
            : "Не удалось сохранить отчёт",
    };
  }
}
export async function uploadTaskPhoto(
  occurrenceId: string,
  itemId: string,
  form: FormData,
) {
  try {
    z.string().uuid().parse(occurrenceId);
    z.string().uuid().parse(itemId);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 12 * 1024 * 1024)
      throw new Error("Выберите фотографию до 12 МБ");
    const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const kind =
      b[0] === 255 && b[1] === 216 && b[2] === 255
        ? { mime: "image/jpeg", ext: "jpg" }
        : b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71
          ? { mime: "image/png", ext: "png" }
          : String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
              String.fromCharCode(...b.slice(8, 12)) === "WEBP"
            ? { mime: "image/webp", ext: "webp" }
            : null;
    if (!kind) throw new Error("Поддерживаются фотографии JPEG, PNG и WebP");
    const { db } = await context();
    const path = `${occurrenceId}/${itemId}/${crypto.randomUUID()}.${kind.ext}`;
    const r = await db.storage
      .from("task-evidence")
      .upload(path, file, { contentType: kind.mime });
    if (r.error) throw new Error("Не удалось загрузить фотографию");
    return { path };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Не удалось загрузить фотографию",
    };
  }
}
export async function taskPhotoUrl(path: string) {
  if (
    !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path)
  )
    return { error: "Неверная фотография" };
  const { db } = await context();
  const r = await db.storage.from("task-evidence").createSignedUrl(path, 600);
  return r.error
    ? { error: "Фотография недоступна" }
    : { url: r.data?.signedUrl };
}
export async function taskHistory(id: string) {
  z.string().uuid().parse(id);
  const { db } = await context();
  const r = await db
    .from<
      {
        id: string;
        action: string;
        details: { comment?: string };
        created_at: string;
      }[]
    >("schedule_task_history")
    .select("id,action,details,created_at")
    .eq("entity_id", id)
    .order("created_at");
  if (r.error) throw new Error("История недоступна");
  return r.data ?? [];
}
export async function previewTasks(from: string, to: string) {
  const { db } = await context();
  const r = await db.rpc("schedule_task_preview", { p_from: from, p_to: to });
  if (r.error) return { error: r.error.message };
  return { rows: r.data as TaskPreview[] };
}
export async function retryTaskMessage(id: string, evidence: string) {
  try {
    z.string().uuid().parse(id);
    const { db } = await context();
    const r = await db.rpc("schedule_retry_task_message", {
      p_id: id,
      p_evidence: evidence,
    });
    if (r.error) throw new Error(r.error.message);
    revalidatePath("/schedule/tasks");
    return { ok: true };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Не удалось повторить отправку",
    };
  }
}
