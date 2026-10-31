"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
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
export async function deleteCandidates(ids: string[]) {
  const selected = z.array(uuid).min(1).max(100).parse(ids);
  const scope = await candidateScope();
  if (!scope.permissions.owner) throw new Error("Доступно только владельцу аккаунта");
  const deleted = result(await scope.db.rpc("candidate_delete_many", { p_ids: selected })) as number;
  revalidatePath("/people/candidates", "layout");
  revalidatePath("/schedule");
  return deleted;
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
      .is("revoked_at", null)
      .maybeSingle(),
  );
  if (!row?.password_secret) return null;
  return {
    user_number: row.user_number,
    password: decryptSecret(row.password_secret),
  };
}
