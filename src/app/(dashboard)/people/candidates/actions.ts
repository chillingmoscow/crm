"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  candidateScope,
  candidateList,
  candidateBoard,
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
import { transferCandidateFile } from "@/lib/candidates/jobs";
import { actionResult } from "@/lib/actions/result";
const result = <T>(r: {
  data: T | null;
  error: { message: string } | null;
}) => {
  if (r.error)
    throw new Error(
      r.error.message.includes("candidate_appointments_one_interview")
        ? "Собеседование уже назначено. Измените его в разделе «Коммуникация»"
        : r.error.message,
    );
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
const boardInput = listingFilters
  .pick({ search: true, position: true, from: true, to: true })
  .extend({
    stages: z
      .array(z.enum(["new", "review", "interview", "trial", "rejected"]))
      .max(5),
  });
async function listCandidateBoardImpl(input: unknown) {
  const { stages, ...filters } = boardInput.parse(input);
  return candidateBoard(filters, [...new Set(stages)]);
}
async function listCandidatesImpl(filters: ListFilters) {
  return candidateList(listingFilters.parse(filters));
}
async function countNewCandidatesImpl() {
  const db = asLooseDb(await createClient());
  const count = result(await db.rpc("candidate_new_count", {}));
  return typeof count === "number" ? count : 0;
}
async function getCandidateImpl(id: string) {
  const detail = await candidateDetail(uuid.parse(id));
  if (!detail) throw new Error("Анкета не найдена");
  return detail;
}
async function getCandidateOptionsImpl() {
  return candidateOptions();
}
async function getCandidateAppointmentsImpl(id: string) {
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
async function updateCandidateImpl(id: string, input: unknown) {
  return command("update", uuid.parse(id), candidateUpdate.parse(input));
}
async function commentCandidateImpl(
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
async function saveCandidateAppointmentImpl(id: string, input: unknown) {
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
async function saveCandidateAppointmentResultImpl(id: string, input: unknown) {
  return appointmentCommand(id, "result", z.object({
    id: uuid,
    revision: z.number().int().positive(),
    outcome: z.enum(["passed", "no_show", "rejected", "canceled"]),
    notes: z.string().trim().max(12000),
    interview_feedback: interviewFeedback,
  }).parse(input));
}
async function editCandidateCommentImpl(candidateId: string, commentId: string, revision: number, body: string | null, remove = false) {
  const scope = await candidateScope();
  result(await scope.db.rpc("candidate_edit_comment", {
    p_candidate: uuid.parse(candidateId), p_comment: uuid.parse(commentId),
    p_revision: z.number().int().positive().parse(revision),
    p_body: remove ? null : z.string().trim().min(1).max(12000).parse(body), p_delete: remove,
  }));
  revalidatePath("/people/candidates", "layout");
}
async function deleteCandidateImpl(id: string) {
  return command("delete", uuid.parse(id), {});
}
async function deleteCandidatesImpl(ids: string[]) {
  const selected = z.array(uuid).min(1).max(100).parse(ids);
  const scope = await candidateScope();
  if (!scope.permissions.owner) throw new Error("Доступно только владельцу аккаунта");
  const deleted = result(await scope.db.rpc("candidate_delete_many", { p_ids: selected })) as number;
  revalidatePath("/people/candidates", "layout");
  revalidatePath("/schedule");
  return deleted;
}
async function uploadCandidateFileImpl(id: string, form: FormData) {
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
type CandidateFileRow = {
  id: string;
  account_id: string;
  candidate_id: string;
  name: string;
  state: string;
  original_url: string | null;
  storage_path: string | null;
  attempts: number;
};
async function candidateFileRow(candidateId: string, fileId: string) {
  const s = await candidateScope();
  const file = result(
    await s.db
      .from<CandidateFileRow>("candidate_files")
      .select("id,account_id,candidate_id,name,state,original_url,storage_path,attempts")
      .eq("id", uuid.parse(fileId))
      .eq("candidate_id", uuid.parse(candidateId))
      .eq("account_id", s.accountId)
      .maybeSingle(),
  );
  if (!file) throw new Error("Файл не найден. Обновите страницу");
  return { s, file };
}
/** «Повторить» у файла, который очередь не смогла перенести. */
async function retryCandidateFileImpl(candidateId: string, fileId: string) {
  const { s, file } = await candidateFileRow(candidateId, fileId);
  if (file.state !== "error") throw new Error("Файл уже не ждёт повтора. Обновите страницу");
  const outcome = await transferCandidateFile(s.admin, createAdminClient(), file);
  revalidatePath("/people/candidates", "layout");
  return outcome;
}
/** «Убрать» запись о файле, который так и не попал в хранилище. */
async function removeCandidateFileImpl(candidateId: string, fileId: string) {
  const { s, file } = await candidateFileRow(candidateId, fileId);
  if (file.state !== "error" && file.state !== "missing")
    throw new Error("Убрать можно только файл, который не удалось перенести");
  result(
    await s.admin
      .from("candidate_files")
      .delete()
      .eq("id", file.id)
      .eq("account_id", s.accountId),
  );
  // Перенос мог успеть загрузить копию до сбоя записи — убираем и её.
  const paths = [
    `${file.account_id}/${file.candidate_id}/${file.id}`,
    file.storage_path,
  ].filter((p): p is string => Boolean(p));
  await createAdminClient().storage.from("candidate-files").remove([...new Set(paths)]);
  result(
    await s.admin.from("candidate_events").insert({
      account_id: s.accountId,
      candidate_id: file.candidate_id,
      actor_id: s.user.id,
      kind: "file_removed",
      details: { name: file.name },
    }),
  );
  revalidatePath("/people/candidates", "layout");
}
async function hireCandidateImpl(id: string, input: unknown) {
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
  if (!payload.gender) {
    // Без пола — только продолжение найма, начатого до того, как пол стал
    // обязательным: его сохранённый вход нельзя менять.
    const unfinished = result(
      await s.admin
        .from<{ state: string }>("candidate_hires")
        .select("state")
        .eq("account_id", s.accountId)
        .eq("candidate_id", uuid.parse(id))
        .neq("state", "complete")
        .maybeSingle(),
    );
    if (!unfinished) throw new Error("Укажите пол");
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
async function createCandidateRoleImpl(venueId: string, input: unknown) {
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
async function getCandidateDoorCodeImpl(userId: string) {
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

// Действия возвращают ошибку текстом, а не исключением: в рабочей сборке Next.js
// заменяет текст брошенного исключения английской заглушкой (см. lib/actions/result).
export async function listCandidates(filters: ListFilters) {
  return actionResult(() => listCandidatesImpl(filters), "Не удалось загрузить кандидатов");
}
export async function listCandidateBoard(input: {
  search?: string;
  position?: string;
  from?: string;
  to?: string;
  stages: string[];
}) {
  return actionResult(() => listCandidateBoardImpl(input), "Не удалось загрузить доску кандидатов");
}
export async function countNewCandidates() {
  return actionResult(() => countNewCandidatesImpl(), "Не удалось посчитать новых кандидатов");
}
export async function getCandidate(id: string) {
  return actionResult(() => getCandidateImpl(id), "Не удалось загрузить анкету");
}
export async function getCandidateOptions() {
  return actionResult(() => getCandidateOptionsImpl(), "Не удалось загрузить справочники");
}
export async function getCandidateAppointments(id: string) {
  return actionResult(() => getCandidateAppointmentsImpl(id), "Не удалось загрузить встречи");
}
export async function updateCandidate(id: string, input: unknown) {
  return actionResult(() => updateCandidateImpl(id, input), "Не удалось сохранить анкету");
}
export async function commentCandidate(id: string, body: string, requestKey: string) {
  return actionResult(() => commentCandidateImpl(id, body, requestKey), "Не удалось отправить комментарий");
}
export async function saveCandidateAppointment(id: string, input: unknown) {
  return actionResult(() => saveCandidateAppointmentImpl(id, input), "Не удалось сохранить встречу");
}
export async function saveCandidateAppointmentResult(id: string, input: unknown) {
  return actionResult(() => saveCandidateAppointmentResultImpl(id, input), "Не удалось сохранить итог встречи");
}
export async function editCandidateComment(candidateId: string, commentId: string, revision: number, body: string | null, remove = false) {
  return actionResult(
    () => editCandidateCommentImpl(candidateId, commentId, revision, body, remove),
    remove ? "Не удалось удалить комментарий" : "Не удалось сохранить комментарий",
  );
}
export async function deleteCandidate(id: string) {
  return actionResult(() => deleteCandidateImpl(id), "Не удалось удалить анкету");
}
export async function deleteCandidates(ids: string[]) {
  return actionResult(() => deleteCandidatesImpl(ids), "Не удалось удалить анкеты");
}
export async function uploadCandidateFile(id: string, form: FormData) {
  return actionResult(() => uploadCandidateFileImpl(id, form), "Не удалось загрузить файл");
}
export async function retryCandidateFile(candidateId: string, fileId: string) {
  return actionResult(() => retryCandidateFileImpl(candidateId, fileId), "Не удалось повторить перенос файла");
}
export async function removeCandidateFile(candidateId: string, fileId: string) {
  return actionResult(() => removeCandidateFileImpl(candidateId, fileId), "Не удалось убрать файл");
}
export async function hireCandidate(id: string, input: unknown) {
  return actionResult(() => hireCandidateImpl(id, input), "Не удалось принять кандидата");
}
export async function createCandidateRole(venueId: string, input: unknown) {
  return actionResult(() => createCandidateRoleImpl(venueId, input), "Не удалось создать должность");
}
export async function getCandidateDoorCode(userId: string) {
  return actionResult(() => getCandidateDoorCodeImpl(userId), "Не удалось получить код замка");
}
