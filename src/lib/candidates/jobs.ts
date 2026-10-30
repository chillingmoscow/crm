import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { decryptSecret } from "@/lib/integrations/crypto";
import { allowedPhotoURL } from "./schema";
import type { CandidateFile } from "./types";
type Job = {
  id: string;
  account_id: string;
  candidate_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
};
const check = <T>(r: { data: T | null; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
};
export async function processCandidateJobs(limit = 5) {
  const admin = createAdminClient(),
    db = asLooseDb(admin);
  let processed = 0,
    errors = 0;
  for (let i = 0; i < limit; i++) {
    const job = check(await db.rpc("candidate_claim_job", {})) as Job | null;
    if (!job) break;
    try {
      if (job.kind === "file_cleanup") {
        const paths = job.payload.paths;
        if (
          Array.isArray(paths) &&
          paths.every(
            (p) => typeof p === "string" && p.startsWith(job.account_id + "/"),
          )
        )
          check(await admin.storage.from("candidate-files").remove(paths));
      }
      if (["notify", "hired"].includes(job.kind) && job.candidate_id) {
        if (job.kind === "notify") check(
          await db.rpc("candidate_notify_in_app", {
            p_candidate: job.candidate_id,
          }),
        );
        const recruitingConnection = check(
          await db
            .from<{
              telegram_chat_id: string | null;
              telegram_secret: {
                encrypted: string;
                iv: string;
                tag: string;
              } | null;
            }>("candidate_connections")
            .select("telegram_chat_id,telegram_secret")
            .eq("account_id", job.account_id)
            .maybeSingle(),
        );
        const organization = check(await db.from<{secret:{encrypted:string;iv:string;tag:string};default_chat_id:string|null}>("organization_telegram_settings").select("secret,default_chat_id").eq("account_id",job.account_id).maybeSingle());
        const connection = {telegram_chat_id: job.kind === "hired"
          ? organization?.default_chat_id || recruitingConnection?.telegram_chat_id
          : recruitingConnection?.telegram_chat_id || organization?.default_chat_id,
          telegram_secret: organization?.secret || recruitingConnection?.telegram_secret};
        if (job.kind === "hired" && (!connection?.telegram_chat_id || !connection.telegram_secret))
          throw new Error("Настройте Telegram-бота и чат для уведомления о найме");
        if (connection?.telegram_chat_id && connection.telegram_secret) {
          if (job.payload.telegram === "started")
            throw new Error(
              "Отправка в Telegram не подтверждена. Проверьте чат перед повтором",
            );
          if (job.payload.telegram !== "done") {
            const candidate = check(
              await db
                .from<{ full_name: string; desired_position: string | null }>(
                  "candidates",
                )
                .select("full_name,desired_position")
                .eq("id", job.candidate_id)
                .eq("account_id", job.account_id)
                .single(),
            );
            job.payload.telegram = "started";
            check(
              await db
                .from("candidate_jobs")
                .update({ payload: job.payload })
                .eq("id", job.id),
            );
            const origin = process.env.NEXT_PUBLIC_SITE_URL;
            if (!origin)
              throw new Error(
                "Настройте адрес приложения NEXT_PUBLIC_SITE_URL",
              );
            const token = decryptSecret(connection.telegram_secret);
            const response = await fetch(
              `https://api.telegram.org/bot${token}/sendMessage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: connection.telegram_chat_id,
                  text: job.kind === "hired"
                    ? `👤 В нашей команде появился новый ${String(job.payload.role_name ?? "сотрудник")} — ${String(job.payload.name ?? candidate.full_name)}\n${new URL(`/people/staff/${job.payload.user_id}`, origin)}`
                    : `Новая анкета: ${candidate.full_name}\nДолжность: ${candidate.desired_position ?? "Не указана"}\n${new URL(`/people/candidates/${job.candidate_id}`, origin)}`,
                  link_preview_options: { is_disabled: true },
                }),
                signal: AbortSignal.timeout(12000),
              },
            );
            const body = (await response.json()) as { ok?: boolean };
            if (!response.ok || !body.ok)
              throw new Error("Telegram не подтвердил отправку уведомления");
            job.payload.telegram = "done";
            check(
              await db
                .from("candidate_jobs")
                .update({ payload: job.payload })
                .eq("id", job.id),
            );
          }
        }
      }
      check(
        await db
          .from("candidate_jobs")
          .update({ state: "done", lease_until: null, error: null })
          .eq("id", job.id),
      );
      processed++;
    } catch (e) {
      errors++;
      await db
        .from("candidate_jobs")
        .update({
          state: "error",
          lease_until: null,
          error: e instanceof Error ? e.message : "Ошибка обработки",
          available_at: new Date(
            Date.now() + Math.min(3600000, 30000 * 2 ** job.attempts),
          ).toISOString(),
        })
        .eq("id", job.id);
    }
  }
  const files =
    check(
      await db
        .from<
          (CandidateFile & {
            account_id: string;
            candidate_id: string;
            attempts: number;
          })[]
        >("candidate_files")
        .select("*")
        .in("state", ["pending", "error"])
        .or("attempts.lt.5")
        .order("created_at")
        .limit(5),
    ) ?? [];
  for (const file of files) {
    if (file.attempts >= 5) continue;
    try {
      if (!file.original_url || !allowedPhotoURL(file.original_url))
        throw new Error("Адрес файла не разрешён");
      const response = await fetch(file.original_url, {
        redirect: "manual",
        signal: AbortSignal.timeout(12000),
      });
      if (response.status === 404 || response.status === 410) {
        check(
          await db
            .from("candidate_files")
            .update({
              state: "missing",
              error: "Файл недоступен в исходном хранилище",
              attempts: file.attempts + 1,
            })
            .eq("id", file.id),
        );
        continue;
      }
      if (!response.ok || !response.body)
        throw new Error("Не удалось получить исходный файл");
      const mime = (response.headers.get("content-type") ?? "").split(";")[0];
      if (
        ![
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/avif",
          "image/gif",
          "application/pdf",
        ].includes(mime)
      )
        throw new Error("Неподдерживаемый тип файла");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const r = await reader.read();
        if (r.done) break;
        size += r.value.byteLength;
        if (size > 10485760) {
          await reader.cancel();
          throw new Error("Файл больше 10 МБ");
        }
        chunks.push(r.value);
      }
      const path = `${file.account_id}/${file.candidate_id}/${file.id}`;
      check(
        await admin.storage
          .from("candidate-files")
          .upload(path, Buffer.concat(chunks), {
            contentType: mime,
            upsert: true,
          }),
      );
      check(
        await db
          .from("candidate_files")
          .update({
            state: "ready",
            storage_path: path,
            mime_type: mime,
            size_bytes: size,
            error: null,
            attempts: file.attempts + 1,
          })
          .eq("id", file.id),
      );
    } catch (e) {
      await db
        .from("candidate_files")
        .update({
          state: "error",
          error: e instanceof Error ? e.message : "Ошибка файла",
          attempts: file.attempts + 1,
        })
        .eq("id", file.id);
      errors++;
    }
  }
  return { processed, errors };
}
