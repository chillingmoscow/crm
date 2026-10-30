"use server";
import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { encryptSecret } from "@/lib/integrations/crypto";
import {
  candidateScope,
  candidateList,
  candidateDetail,
  candidateOptions,
  candidateAppointments,
} from "@/lib/candidates/data";
import { uuid, candidateUpdate, hireInput } from "@/lib/candidates/schema";
import type {
  ListFilters,
  ConnectionView,
  CandidateStatus,
} from "@/lib/candidates/types";
import { CANDIDATE_SORT_FIELDS } from "@/lib/candidates/types";
import { provisionCandidateHire } from "@/lib/candidates/provision";
const result = <T>(r: {
  data: T | null;
  error: { message: string } | null;
}) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const listingFilters = z.object({
  search: z.string().max(100).optional(),
  status: z.union([
    z.enum(["new", "review", "interview", "trial", "rejected", ""]),
    z.array(z.enum(["new", "review", "interview", "trial", "rejected"])).max(5),
  ]).optional(),
  position: z.string().max(300).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  page: z.number().int().min(0).max(10000).optional(),
  pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).optional(),
  sort: z
    .array(
      z.object({
        field: z.enum(CANDIDATE_SORT_FIELDS),
        direction: z.enum(["asc", "desc"]),
      }),
    )
    .max(CANDIDATE_SORT_FIELDS.length)
    .refine(
      (items) => new Set(items.map((s) => s.field)).size === items.length,
      "Поля сортировки не должны повторяться",
    )
    .optional(),
});
export async function listCandidates(filters: ListFilters) {
  return candidateList(listingFilters.parse(filters));
}
export async function countNewCandidates() {
  const db = asLooseDb(await createClient());
  const count = result(await db.rpc("candidate_new_count", {}));
  return typeof count === "number" ? count : 0;
}
export async function getCandidate(id: string) {
  return candidateDetail(uuid.parse(id));
}
export async function getCandidateOptions() {
  return candidateOptions();
}
export async function getCandidateAppointments(id: string) {
  return candidateAppointments(uuid.parse(id));
}
async function command(action: string, id: string | null, input: unknown) {
  const s = await candidateScope();
  const r = await s.db.rpc("candidate_command", {
    p_action: action,
    p_id: id,
    p_input: input,
  });
  const data = result(r) as {
    id: string;
    revision: number;
    status: CandidateStatus;
  };
  const isStatusOnly = action === "update" && input !== null && typeof input === "object" &&
    Object.keys(input).every((key) => key === "revision" || key === "status");
  if (!isStatusOnly) revalidatePath("/people/candidates", "layout");
  if (action !== "comment") revalidatePath("/schedule");
  return data;
}
export async function updateCandidate(id: string, input: unknown) {
  return command("update", uuid.parse(id), candidateUpdate.parse(input));
}
export async function commentCandidate(
  id: string,
  body: string,
  requestKey: string,
) {
  return command("comment", uuid.parse(id), {
    body: z.string().trim().min(1).max(12000).parse(body),
    request_key: uuid.parse(requestKey),
  });
}
const interviewFeedback = z.object({
  punctuality: z.enum(["early", "on_time", "late_warned", "late"]).optional(),
  appearance: z.string().trim().max(2000).optional(),
  communication: z.string().trim().max(2000).optional(),
  smiled: z.union([z.boolean(), z.literal("occasionally")]).optional(),
});
async function appointmentCommand(id: string, mode: "schedule" | "result", input: unknown) {
  const scope = await candidateScope();
  const data = result(await scope.db.rpc("candidate_save_appointment", {
    p_candidate: uuid.parse(id), p_mode: mode, p_input: input,
  })) as { id: string; revision: number; status: CandidateStatus };
  revalidatePath("/people/candidates", "layout");
  revalidatePath("/schedule");
  return data;
}
export async function saveCandidateAppointment(id: string, input: unknown) {
  return appointmentCommand(id, "schedule", z.object({
    id: uuid.optional(),
    revision: z.number().int().positive().optional(),
    kind: z.enum(["interview", "trial"]),
    venue_id: uuid.nullable(),
    appointment_date: z.string().date(),
    starts_at: z.string().datetime({ offset: true }).nullable(),
    timezone: z.string().min(1).max(100),
    location: z.string().max(1000),
    interviewer_id: uuid.nullable(),
  }).superRefine((value, context) => {
    if (value.kind === "trial" && !value.venue_id)
      context.addIssue({ code: "custom", path: ["venue_id"], message: "Выберите заведение для стажировки" });
    if (value.kind === "interview" && !value.starts_at)
      context.addIssue({ code: "custom", path: ["starts_at"], message: "Укажите время собеседования" });
    if (value.kind === "interview" && !value.id && !value.venue_id && !/^https?:\/\/\S+$/i.test(value.location))
      context.addIssue({ code: "custom", path: ["location"], message: "Выберите заведение или добавьте ссылку на собеседование" });
  }).parse(input));
}
export async function saveCandidateAppointmentResult(id: string, input: unknown) {
  return appointmentCommand(id, "result", z.object({
    id: uuid,
    revision: z.number().int().positive(),
    outcome: z.enum(["passed", "no_show", "rejected", "canceled"]),
    notes: z.string().trim().max(12000),
    interview_feedback: interviewFeedback,
  }).parse(input));
}
export async function editCandidateComment(candidateId: string, commentId: string, revision: number, body: string | null, remove = false) {
  const scope = await candidateScope();
  result(await scope.db.rpc("candidate_edit_comment", {
    p_candidate: uuid.parse(candidateId), p_comment: uuid.parse(commentId),
    p_revision: z.number().int().positive().parse(revision),
    p_body: remove ? null : z.string().trim().min(1).max(12000).parse(body), p_delete: remove,
  }));
  revalidatePath("/people/candidates", "layout");
}
export async function candidateLifecycle(
  id: string,
  action: "archive" | "restore" | "delete",
) {
  z.enum(["archive", "restore", "delete"]).parse(action);
  return command(action, uuid.parse(id), {});
}
export async function uploadCandidateFile(id: string, form: FormData) {
  const s = await candidateScope();
  uuid.parse(id);
  result(
    await s.db
      .from("candidates")
      .select("id")
      .eq("id", id)
      .eq("account_id", s.accountId)
      .is("archived_at", null)
      .single(),
  );
  const file = form.get("file");
  if (
    !(file instanceof File) ||
    file.size > 10 * 1024 * 1024 ||
    file.size === 0 ||
    ![
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/avif",
      "image/gif",
      "application/pdf",
    ].includes(file.type)
  )
    throw new Error("Выберите фото или PDF до 10 МБ");
  const fileId = crypto.randomUUID(),
    path = `${s.accountId}/${id}/${fileId}`;
  const admin = createAdminClient();
  result(
    await admin.storage
      .from("candidate-files")
      .upload(path, file, { contentType: file.type, upsert: false }),
  );
  const inserted = await s.admin.from("candidate_files").insert({
    id: fileId,
    account_id: s.accountId,
    candidate_id: id,
    name: file.name.slice(0, 300),
    mime_type: file.type,
    size_bytes: file.size,
    storage_path: path,
    state: "ready",
  });
  if (inserted.error) {
    await admin.storage.from("candidate-files").remove([path]);
    throw new Error(inserted.error.message);
  }
  result(
    await s.admin.from("candidate_events").insert({
      account_id: s.accountId,
      candidate_id: id,
      actor_id: s.user.id,
      kind: "file_added",
      details: { name: file.name },
    }),
  );
  revalidatePath("/people/candidates", "layout");
}
export async function hireCandidate(id: string, input: unknown) {
  const s = await candidateScope();
  if (!s.permissions.hire) throw new Error("Нет права принимать кандидатов");
  const payload = hireInput.parse(input);
  if (payload.existing_user_id) {
    result(
      await s.db.rpc("candidate_link_staff", {
        p_candidate: uuid.parse(id),
        p_user: payload.existing_user_id,
        p_venue: payload.venue_id,
        p_revision: payload.revision,
      }),
    );
    revalidatePath("/people/candidates", "layout");
    revalidatePath("/schedule");
    return { user_id: payload.existing_user_id };
  }
  const hire = result(
    await s.db.rpc("candidate_begin_hire", {
      p_candidate: uuid.parse(id),
      p_input: payload,
    }),
  ) as { id: string; state: string; target_user_id: string };
  if (hire.state !== "complete") await provisionCandidateHire(hire.id);
  revalidatePath("/people/candidates", "layout");
  revalidatePath("/people/staff", "layout");
  revalidatePath("/people/payroll");
  revalidatePath("/schedule");
  return { user_id: hire.target_user_id };
}
export async function createCandidateRole(venueId: string, input: unknown) {
  const s = await candidateScope();
  const money = z.number().finite().min(0).max(1000000000);
  const rate = z.object({
    base: money.nullable(),
    percent: z.number().finite().min(0).max(100).nullable(),
  });
  const value = z
    .object({
      name: z.string().trim().min(2).max(100),
      copy_role_id: uuid.nullable().optional(),
      valid_from: z.string().date(),
      monthly_amount: money,
      basis: z.enum(["none", "turnover", "hookah", "bar"]),
      tips: z.boolean(),
      shift_pay: z.boolean(),
      rates: z.record(z.record(rate)),
      food_amount: money,
      knowledge_amount: money,
      quickresto_role_id: z.number().int().positive().nullable().optional(),
    })
    .parse(input);
  const id = result(
    await s.db.rpc("candidate_create_role", {
      p_venue: uuid.parse(venueId),
      p_input: value,
    }),
  );
  revalidatePath("/people/roles");
  return String(id);
}
export async function candidateConnection(): Promise<ConnectionView> {
  const s = await candidateScope();
  if (!s.permissions.integrations)
    throw new Error("Нет права на настройки интеграций");
  const row = result(
    await s.admin
      .from<{
        id: string;
        enabled: boolean;
        form_id: string;
        telegram_chat_id: string | null;
        telegram_secret: unknown;
        last_received_at: string | null;
      }>("candidate_connections")
      .select(
        "id,enabled,form_id,telegram_chat_id,telegram_secret,last_received_at",
      )
      .eq("account_id", s.accountId)
      .maybeSingle(),
  );
  if (!row) return null;
  const jobs =
    result(
      await s.admin
        .from<{ state: string; attempts: number }[]>("candidate_jobs")
        .select("state,attempts")
        .eq("account_id", s.accountId)
        .neq("state", "done"),
    ) ?? [];
  return {
    id: row.id,
    enabled: row.enabled,
    form_id: row.form_id,
    telegram_chat_id: row.telegram_chat_id,
    telegram_configured: !!row.telegram_secret,
    last_received_at: row.last_received_at,
    pending_jobs: jobs.filter((j) => j.attempts < 10).length,
    failed_jobs: jobs.filter((j) => j.attempts >= 10).length,
  };
}
export async function saveCandidateConnection(input: unknown) {
  const s = await candidateScope();
  if (!s.permissions.integrations)
    throw new Error("Нет права на настройки интеграций");
  const value = z
    .object({
      enabled: z.boolean(),
      form_id: z
        .string()
        .trim()
        .regex(/^form\d+$/),
      telegram_chat_id: z
        .string()
        .trim()
        .regex(/^-?\d+$/)
        .or(z.literal("")),
      telegram_token: z.string().trim().max(300).optional(),
      rotate: z.boolean().optional(),
    })
    .parse(input);
  const old = result(
    await s.admin
      .from<{ id: string; telegram_secret: unknown }>("candidate_connections")
      .select("id,telegram_secret")
      .eq("account_id", s.accountId)
      .maybeSingle(),
  );
  const secret = !old || value.rotate ? randomBytes(32).toString("hex") : null;
  const payload: Record<string, unknown> = {
    account_id: s.accountId,
    enabled: value.enabled,
    form_id: value.form_id,
    telegram_chat_id: value.telegram_chat_id || null,
    created_by: s.user.id,
  };
  if (secret)
    payload.secret_hash = createHash("sha256").update(secret).digest("hex");
  if (value.telegram_token) {
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(value.telegram_token))
      throw new Error("Некорректный токен Telegram-бота");
    payload.telegram_secret = encryptSecret(value.telegram_token);
  }
  const organizationTelegram = result(await s.admin.from<{secret:unknown;default_chat_id:string|null}>("organization_telegram_settings").select("secret,default_chat_id").eq("account_id",s.accountId).maybeSingle());
  if (
    value.enabled &&
    (!(value.telegram_chat_id || organizationTelegram?.default_chat_id) ||
      (!value.telegram_token && !old?.telegram_secret && !organizationTelegram?.secret))
  )
    throw new Error(
      "Настройте Telegram-бота и чат перед включением приёма заявок",
    );
  const row = result(
    await (
      old
        ? s.admin
            .from<{ id: string }>("candidate_connections")
            .update(payload)
            .eq("id", old.id)
            .eq("account_id", s.accountId)
        : s.admin.from<{ id: string }>("candidate_connections").insert(payload)
    )
      .select("id")
      .single(),
  );
  return { id: row!.id, secret };
}
export async function getCandidateDoorCode(userId: string) {
  const s = await candidateScope();
  if (!s.permissions.owner) throw new Error("Коды замка доступны владельцу");
  const { decryptSecret } = await import("@/lib/integrations/crypto");
  const row = result(
    await s.admin
      .from<{
        user_number: number;
        password_secret: { encrypted: string; iv: string; tag: string } | null;
      }>("staff_door_codes")
      .select("user_number,password_secret")
      .eq("account_id", s.accountId)
      .eq("user_id", uuid.parse(userId))
      .maybeSingle(),
  );
  if (!row?.password_secret) return null;
  return {
    user_number: row.user_number,
    password: decryptSecret(row.password_secret),
  };
}
export async function candidateEmploymentSettings(venueId: string) {
  const s = await candidateScope();
  if (!s.permissions.integrations)
    throw new Error("Нет права настройки интеграций");
  uuid.parse(venueId);
  const venues = result(await s.db.rpc("candidate_hiring_options", {})) as {
    venues: { id: string }[];
  };
  if (!venues.venues.some((v) => v.id === venueId))
    throw new Error("Заведение недоступно");
  return result(
    await s.admin
      .from<{
        store_ids: number[];
        master_store_ids: number[];
        staff_group_id: number;
        bonus_account_type_id: number;
        tips_uri: string | null;
        office_pool_initialized: boolean;
      }>("candidate_employment_settings")
      .select(
        "store_ids,master_store_ids,staff_group_id,bonus_account_type_id,office_pool_initialized,tips_uri",
      )
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .maybeSingle(),
  );
}
export async function saveCandidateEmploymentSettings(
  venueId: string,
  input: unknown,
) {
  const s = await candidateScope();
  if (!s.permissions.owner || !s.permissions.integrations)
    throw new Error("Настройка доступна владельцу");
  const value = z
    .object({
      store_ids: z.array(z.number().int().positive()).min(1).max(30),
      master_store_ids: z.array(z.number().int().positive()).max(30),
      staff_group_id: z.number().int().positive(),
      bonus_account_type_id: z.number().int().positive(),
      tips_uri: z.string().trim().max(1000).url().refine(value => value.startsWith("https://"), "Ссылка должна начинаться с https://").nullable().optional(),
      legacy_codes: z.string().max(150000).optional(),
      confirm_empty_pool: z.boolean().optional(),
    })
    .parse(input);
  const options = result(await s.db.rpc("candidate_hiring_options", {})) as {
    venues: { id: string }[];
  };
  if (!options.venues.some((v) => v.id === uuid.parse(venueId)))
    throw new Error("Заведение недоступно");
  // Import only hashes of old passwords; plaintext never leaves this action.
  const lines = (value.legacy_codes ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const reserved = lines.flatMap((line) => {
    const cells = /[\t;,]/.test(line)
      ? line.split(/[\t;,]/)
      : line.trim().split(/ +/);
    const number = (cells[0] ?? "").trim(),
      password = (cells[1] ?? "").trim();
    if (
      (number && !/^\d{3}$/.test(number)) ||
      (password && !/^\d{6}$/.test(password)) ||
      (!number && !password)
    )
      throw new Error(
        "Проверьте номера пользователей и коды. Неполную пару можно оставить: имеющееся значение будет зарезервировано",
      );
    return [
      ...(number
        ? [
            {
              account_id: s.accountId,
              kind: "user",
              value: String(Number(number)),
            },
          ]
        : []),
      ...(password
        ? [
            {
              account_id: s.accountId,
              kind: "password",
              value: createHash("sha256").update(password).digest("hex"),
            },
          ]
        : []),
    ];
  });
  if (reserved.length)
    result(
      await s.admin.from("staff_door_reserved").upsert(reserved, {
        onConflict: "account_id,kind,value",
        ignoreDuplicates: true,
      }),
    );
  const old = result(
    await s.admin
      .from<{
        office_pool_initialized: boolean;
      }>("candidate_employment_settings")
      .select("office_pool_initialized")
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .maybeSingle(),
  );
  result(
    await s.admin.from("candidate_employment_settings").upsert(
      {
        account_id: s.accountId,
        venue_id: venueId,
        store_ids: value.store_ids,
        master_store_ids: value.master_store_ids,
        staff_group_id: value.staff_group_id,
        bonus_account_type_id: value.bonus_account_type_id,
        ...(value.tips_uri !== undefined ? { tips_uri: value.tips_uri } : {}),
        office_pool_initialized:
          old?.office_pool_initialized ||
          reserved.length > 0 ||
          value.confirm_empty_pool === true,
      },
      { onConflict: "venue_id" },
    ),
  );
  return { imported: lines.length };
}
