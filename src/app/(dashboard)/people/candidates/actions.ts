"use server";
import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/integrations/crypto";
import {
  candidateScope,
  candidateList,
  candidateDetail,
  candidateOptions,
} from "@/lib/candidates/data";
import {
  uuid,
  candidateInput,
  candidateUpdate,
  hireInput,
} from "@/lib/candidates/schema";
import type { ListFilters, ConnectionView } from "@/lib/candidates/types";
import { provisionCandidateHire } from "@/lib/candidates/provision";
const result = <T>(r: {
  data: T | null;
  error: { message: string } | null;
}) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
export async function listCandidates(filters: ListFilters) {
  return candidateList(
    z
      .object({
        search: z.string().max(100).optional(),
        status: z
          .enum([
            "new",
            "review",
            "interview",
            "trial",
            "rejected",
            "hired",
            "unknown",
            "",
          ])
          .optional(),
        position: z.string().max(300).optional(),
        responsible: z.union([uuid, z.literal("")]).optional(),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        archive: z.boolean().optional(),
        page: z.number().int().min(0).max(10000).optional(),
      })
      .parse(filters),
  );
}
export async function getCandidate(id: string) {
  return candidateDetail(uuid.parse(id));
}
export async function getCandidateOptions() {
  return candidateOptions();
}
async function command(action: string, id: string | null, input: unknown) {
  const s = await candidateScope(true);
  const r = await s.db.rpc("candidate_command", {
    p_action: action,
    p_id: id,
    p_input: input,
  });
  const data = result(r) as { id: string };
  revalidatePath("/people/candidates", "layout");
  return data;
}
export async function createCandidate(input: unknown) {
  return command("create", null, candidateInput.parse(input));
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
export async function saveCandidateAppointment(id: string, input: unknown) {
  return command(
    "appointment",
    uuid.parse(id),
    z
      .object({
        id: uuid.optional(),
        revision: z.number().int().positive().optional(),
        kind: z.enum(["interview", "trial"]),
        appointment_date: z.string().date(),
        starts_at: z.string().datetime({ offset: true }).nullable(),
        timezone: z.string().min(1).max(100),
        location: z.string().max(1000).optional(),
        interviewer_id: uuid.nullable().optional(),
        outcome: z.enum([
          "scheduled",
          "passed",
          "no_show",
          "rejected",
          "canceled",
        ]),
        notes: z.string().max(12000).optional(),
      })
      .parse(input),
  );
}
export async function candidateLifecycle(
  id: string,
  action: "archive" | "restore" | "delete",
) {
  z.enum(["archive", "restore", "delete"]).parse(action);
  return command(action, uuid.parse(id), {});
}
export async function uploadCandidateFile(id: string, form: FormData) {
  const s = await candidateScope(true);
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
  return { user_id: hire.target_user_id };
}
export async function createCandidateRole(venueId: string, input: unknown) {
  const s = await candidateScope(true);
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
  if (
    value.enabled &&
    (!value.telegram_chat_id ||
      (!value.telegram_token && !old?.telegram_secret))
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
        office_pool_initialized: boolean;
      }>("candidate_employment_settings")
      .select(
        "store_ids,master_store_ids,staff_group_id,bonus_account_type_id,office_pool_initialized",
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
      .from<{ office_pool_initialized: boolean }>(
        "candidate_employment_settings",
      )
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
