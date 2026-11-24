"use server";

import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { validDate } from "@/lib/sales/time";
import { z } from "zod";
import { mediaUrl } from "@/lib/storage/media";
import { actionResult } from "@/lib/actions/result";

async function db() {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error("Войдите в аккаунт");
  return { client, database: asLooseDb(client) };
}
const uuid = z.string().uuid();
const createSchema = z.object({
  id: uuid,
  request_key: uuid,
  employee_id: uuid,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(["bonus", "deduction", "warning", "allowance"]),
  medium: z.enum(["money", "bonus", "none"]),
  amount: z.number().finite().min(0).max(1e9),
  reason: z.string().trim().min(3).max(4000),
});
async function createPayrollEntryImpl(input: z.infer<typeof createSchema>) {
  const value = createSchema.parse(input);
  const { database } = await db();
  const r = await database.rpc("payroll_journal_command", {
    p_action: "create",
    p_input: value,
  });
  if (r.error) throw new Error(r.error.message);
  return String(r.data);
}

const bonusBatchSchema = z.object({
  request_key: uuid,
  date: z.string().refine(validDate, "Проверьте дату начисления"),
  medium: z.enum(["money", "bonus"]),
  reason: z.string().trim().min(3).max(4000),
  bank_account_id: uuid.optional(),
  payout_date: z.string().refine(validDate, "Проверьте дату выплаты").optional(),
  recipients: z.array(z.object({
    employee_id: uuid,
    amount: z.number().positive().max(1e9)
      .refine((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 0.00001,
        "Не больше двух знаков после запятой"),
  })).min(1).max(500),
});

async function recordPayrollBonusesImpl(input: z.infer<typeof bonusBatchSchema>) {
  const value = bonusBatchSchema.parse(input);
  const { database } = await db();
  const result = await database.rpc("payroll_record_bonuses", { p_input: value });
  if (result.error) throw new Error(result.error.message);
  return result.data as string[];
}
const editSchema = z.object({
  id: uuid,
  amount: z.number().finite().min(0).max(1e9),
  reason: z.string().trim().min(3).max(4000),
  expected_amount: z.number().finite(),
  expected_reason: z.string(),
});
async function updatePayrollEntryImpl(input: z.infer<typeof editSchema>) {
  const value = editSchema.parse(input);
  const { database } = await db();
  const result = await database.rpc("payroll_update_entry", {p_input:value});
  if (result.error) throw new Error(result.error.message);
}

async function deletePayrollEntryImpl(id: string, reason: string) {
  const input = z
    .object({ id: uuid, reason: z.string().trim().min(3).max(1000) })
    .parse({ id, reason });
  const { database } = await db();
  const r = await database.rpc("payroll_journal_command", {
    p_action: "delete",
    p_input: input,
  });
  if (r.error) throw new Error(r.error.message);
  // Запись, проведённая бонусами Quick Resto, удаляется только после возврата
  // бонусов: команда ставит возврат в очередь, а запись пока остаётся в расчёте.
  const after = await database
    .from<{ deleted_at: string | null }>("payroll_adjustments")
    .select("deleted_at")
    .eq("id", input.id)
    .single();
  if (after.error) throw new Error(after.error.message);
  return { bonusReturnQueued: after.data?.deleted_at === null };
}
async function commentPayrollEntryImpl(
  id: string,
  body: string,
  requestKey: string,
) {
  const input = z
    .object({
      id: uuid,
      body: z.string().trim().min(1).max(4000),
      request_key: uuid,
    })
    .parse({ id, body, request_key: requestKey });
  const { database } = await db();
  const r = await database.rpc("payroll_journal_command", {
    p_action: "comment",
    p_input: input,
  });
  if (r.error) throw new Error(r.error.message);
}
export type PayrollEntryDetail = {
  comments: {
    id: string;
    author_id: string | null;
    source_author_name?: string | null;
    body: string;
    created_at: string;
    author_name: string;
  }[];
  history: {
    id: string;
    actor_name: string;
    action: string;
    created_at: string;
    details: Record<string, unknown>;
  }[];
  photos: { id: string; name: string; url: string }[];
  /** Telegram chat notification that failed; null when sent, pending or not queued. */
  notification: { final: boolean; last_error: string | null } | null;
  /** Возврат бонусов Quick Resto, поставленный при удалении записи; null — не запрошен. */
  bonusReturn: { state: string; message: string | null } | null;
};
// Matches the worker's cap (migration 316): after this many failures the row is never retried.
const NOTIFY_MAX_ATTEMPTS = 8;
async function loadPayrollEntryImpl(
  id: string,
): Promise<PayrollEntryDetail> {
  uuid.parse(id);
  const { database } = await db();
  // Parent RLS prevents probing attachments for another employee or venue.
  const parent = await database
    .from<{id:string;created_at:string;created_by:string|null;managed:boolean}>("payroll_adjustments")
    .select("id,created_at,created_by,managed")
    .eq("id", id)
    .single();
  if (parent.error || !parent.data) throw new Error("Запись недоступна");
  const [comments, history, photos, notification] = await Promise.all([
    database
      .from<PayrollEntryDetail["comments"]>("payroll_adjustment_comments")
      .select("*")
      .eq("adjustment_id", id)
      .order("created_at")
      .limit(1000),
    database
      .from<PayrollEntryDetail["history"]>("payroll_adjustment_history")
      .select("*")
      .eq("adjustment_id", id)
      .order("created_at", { ascending: false })
      .limit(1000),
    database
      .from<{ id: string; name: string; storage_path: string }[]>(
        "payroll_adjustment_photos",
      )
      .select("id,name,storage_path")
      .eq("adjustment_id", id)
      .limit(100),
    database
      .from<{ state: string; attempts: number; last_error: string | null }>(
        "payroll_adjustment_notifications",
      )
      .select("state,attempts,last_error")
      .eq("adjustment_id", id)
      .maybeSingle(),
  ]);
  for (const r of [comments, history, photos])
    if (r.error) throw new Error(r.error.message);
  const names = new Map(
    (history.data ?? [])
      .filter((h) => h.action === "commented")
      .map((h) => [h.details.comment_id, h.actor_name]),
  );
  const entries = [...(history.data ?? [])];
  // Older imports have no original author/event. Show the actual import time,
  // never invent an original creation event or assign it to the current viewer.
  if (!entries.some((h) => h.action === "created") && parent.data.created_at) {
    let author = parent.data.managed ? "Автор не указан" : "Прежний учёт";
    if (parent.data.created_by) {
      const profile = await database.from<{first_name:string|null;last_name:string|null}>("profiles").select("first_name,last_name").eq("id", parent.data.created_by).maybeSingle();
      if (profile.error) throw new Error(profile.error.message);
      if (profile.data) author = [profile.data.first_name, profile.data.last_name].filter(Boolean).join(" ") || author;
    }
    entries.push({id:`creation:${id}`,actor_name:author,action:parent.data.managed ? "created" : "imported",created_at:parent.data.created_at,details:{}});
  }
  // История идёт от новых к старым: первая запись об обратной операции — её текущее состояние.
  const reverse = (history.data ?? []).find(
    (h) => h.action === "bonus_operation" && h.details.operation === "reverse",
  );
  return {
    bonusReturn: reverse
      ? {
          state: String(reverse.details.state),
          message: typeof reverse.details.message === "string" ? reverse.details.message : null,
        }
      : null,
    comments: (comments.data ?? []).map((c) => ({
      ...c,
      author_name: c.source_author_name ?? names.get(c.id) ?? "Сотрудник",
    })),
    history: entries,
    // The mark is optional: a missing queue table (code ahead of the migration) must not break the entry.
    notification: !notification.error && notification.data?.state === "error"
      ? { final: notification.data.attempts >= NOTIFY_MAX_ATTEMPTS, last_error: notification.data.last_error }
      : null,
    // Строки фото уже отобраны с правами пользователя; файл читается от его
    // имени. Постоянный адрес — браузер держит фото месяц.
    photos: (photos.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      url: mediaUrl("payroll-photos", p.storage_path),
    })),
  };
}
async function uploadPayrollPhotoImpl(id: string, form: FormData) {
  uuid.parse(id);
  const file = form.get("file");
  if (!(file instanceof File) || file.size > 5 * 1024 * 1024 || file.size < 12)
    throw new Error("Выберите фотографию до 5 МБ");
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const mime =
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      ? "image/jpeg"
      : bytes[0] === 137 &&
          bytes[1] === 80 &&
          bytes[2] === 78 &&
          bytes[3] === 71
        ? "image/png"
        : String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
            String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
          ? "image/webp"
          : null;
  if (!mime) throw new Error("Поддерживаются JPG, PNG и WebP");
  const { database, client } = await db();
  const r = await database
    .from<{ account_id: string; venue_id: string }>("payroll_adjustments")
    .select("account_id,venue_id")
    .eq("id", id)
    .single();
  if (r.error || !r.data) throw new Error("Запись недоступна");
  const path = `${r.data.account_id}/${r.data.venue_id}/${id}/${crypto.randomUUID()}.${mime.split("/")[1]}`;
  const uploaded = await client.storage
    .from("payroll-photos")
    .upload(path, file, { contentType: mime, upsert: false });
  if (uploaded.error) throw new Error(uploaded.error.message);
  const registered = await database.rpc("payroll_journal_command", {
    p_action: "photo",
    p_input: { id, path, name: file.name },
  });
  if (registered.error) throw new Error(registered.error.message);
}

const disciplineSchema = z.object({
  enabled: z.boolean(),
  valid_from: z.string(),
  version: z.number().int(),
  warning_steps: z
    .array(
      z.object({
        count: z.number().int().min(1).max(1000),
        amount: z.number().positive().max(1e6),
      }),
    )
    .max(20),
  late_enabled: z.boolean(),
  late_grace: z.number().int().min(0).max(120),
  late_step: z.number().int().min(1).max(120),
  late_amount: z.number().min(0).max(1e6),
  late_max: z.number().min(0).max(1e6),
  late_bonus: z.boolean(),
  missing_enabled: z.boolean(),
  missing_amount: z.number().min(0).max(1e6),
  unclosed_enabled: z.boolean(),
  unclosed_amount: z.number().min(0).max(1e6),
  bonus_mode: z.literal("parallel"),
});
export type DisciplineSettings = z.infer<typeof disciplineSchema>;
async function loadDisciplineSettingsImpl(): Promise<DisciplineSettings | null> {
  const { database } = await db();
  const r = await database
    .from<DisciplineSettings>("payroll_discipline_settings")
    .select("*")
    // Правил у заведения может ещё не быть — это не ошибка загрузки:
    // экран пишет «Настройки … ещё не созданы» вместо технического текста.
    .maybeSingle();
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
async function saveDisciplineSettingsImpl(input: DisciplineSettings) {
  const value = disciplineSchema.parse(input);
  const { database } = await db();
  const r = await database.rpc("payroll_save_discipline", { p_input: value });
  if (r.error) throw new Error(r.error.message);
}

// Действия возвращают ошибку текстом, а не исключением: в рабочей сборке Next.js
// заменяет текст брошенного исключения английской заглушкой (см. lib/actions/result).
export async function createPayrollEntry(input: z.infer<typeof createSchema>) {
  return actionResult(() => createPayrollEntryImpl(input), "Не удалось сохранить запись");
}
export async function recordPayrollBonuses(input: z.infer<typeof bonusBatchSchema>) {
  return actionResult(() => recordPayrollBonusesImpl(input), "Не удалось начислить премии");
}
export async function updatePayrollEntry(input: z.infer<typeof editSchema>) {
  return actionResult(() => updatePayrollEntryImpl(input), "Не удалось сохранить изменения");
}
export async function deletePayrollEntry(id: string, reason: string) {
  return actionResult(() => deletePayrollEntryImpl(id, reason), "Не удалось удалить запись");
}
export async function commentPayrollEntry(id: string, body: string, requestKey: string) {
  return actionResult(() => commentPayrollEntryImpl(id, body, requestKey), "Не удалось отправить комментарий");
}
export async function loadPayrollEntry(id: string) {
  return actionResult(() => loadPayrollEntryImpl(id), "Не удалось загрузить запись");
}
export async function uploadPayrollPhoto(id: string, form: FormData) {
  return actionResult(() => uploadPayrollPhotoImpl(id, form), "Не удалось загрузить фотографию");
}
export async function loadDisciplineSettings() {
  return actionResult(() => loadDisciplineSettingsImpl(), "Не удалось загрузить настройки");
}
export async function saveDisciplineSettings(input: DisciplineSettings) {
  return actionResult(() => saveDisciplineSettingsImpl(input), "Не удалось сохранить настройки");
}
