"use server";

import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { z } from "zod";

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
export async function createPayrollEntry(input: z.infer<typeof createSchema>) {
  const value = createSchema.parse(input);
  const { database } = await db();
  const r = await database.rpc("payroll_journal_command", {
    p_action: "create",
    p_input: value,
  });
  if (r.error) throw new Error(r.error.message);
  return String(r.data);
}
const editSchema = z.object({
  id: uuid,
  amount: z.number().finite().min(0).max(1e9),
  reason: z.string().trim().min(3).max(4000),
  expected_amount: z.number().finite(),
  expected_reason: z.string(),
});
export async function updatePayrollEntry(input: z.infer<typeof editSchema>) {
  const value = editSchema.parse(input);
  const { database } = await db();
  const result = await database.rpc("payroll_update_entry", {p_input:value});
  if (result.error) throw new Error(result.error.message);
}

export async function deletePayrollEntry(id: string, reason: string) {
  const input = z
    .object({ id: uuid, reason: z.string().trim().min(3).max(1000) })
    .parse({ id, reason });
  const { database } = await db();
  const r = await database.rpc("payroll_journal_command", {
    p_action: "delete",
    p_input: input,
  });
  if (r.error) throw new Error(r.error.message);
}
export async function commentPayrollEntry(
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
    author_id: string;
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
};
export async function loadPayrollEntry(
  id: string,
): Promise<PayrollEntryDetail> {
  uuid.parse(id);
  const { client, database } = await db();
  // Parent RLS prevents probing attachments for another employee or venue.
  const parent = await database
    .from<{id:string;created_at:string;created_by:string|null;managed:boolean}>("payroll_adjustments")
    .select("id,created_at,created_by,managed")
    .eq("id", id)
    .single();
  if (parent.error || !parent.data) throw new Error("Запись недоступна");
  const [comments, history, photos] = await Promise.all([
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
  return {
    comments: (comments.data ?? []).map((c) => ({
      ...c,
      author_name: names.get(c.id) ?? "Сотрудник",
    })),
    history: entries,
    photos: await Promise.all(
      (photos.data ?? []).map(async (p) => {
        const signed = await client.storage
          .from("payroll-photos")
          .createSignedUrl(p.storage_path, 900);
        if (signed.error) throw new Error(signed.error.message);
        return { id: p.id, name: p.name, url: signed.data.signedUrl };
      }),
    ),
  };
}
export async function uploadPayrollPhoto(id: string, form: FormData) {
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
export async function loadDisciplineSettings(): Promise<DisciplineSettings | null> {
  const { database } = await db();
  const r = await database
    .from<DisciplineSettings>("payroll_discipline_settings")
    .select("*")
    .single();
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
export async function saveDisciplineSettings(input: DisciplineSettings) {
  const value = disciplineSchema.parse(input);
  const { database } = await db();
  const r = await database.rpc("payroll_save_discipline", { p_input: value });
  if (r.error) throw new Error(r.error.message);
}
