"use server";

import { z } from "zod";

import {
  createClient,
  getCachedUser,
  getCachedActiveAccountId,
} from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMail, isMailerConfigured } from "@/lib/mail/transporter";
import {
  buildIssueBody,
  buildIssueTitle,
  issueLabels,
  type SupportCategory,
  type SupportContext,
} from "./build-issue-body";
import { createSupportIssue, isGithubConfigured } from "./github";

const BUCKET = "support-attachments";
const MAX_FILE_BYTES = 25 * 1024 * 1024; // совпадает с client-guard'ом
const RATE_LIMIT_PER_HOUR = 10;

const SchemaInput = z.object({
  category: z.enum(["bug", "idea", "question"]),
  description: z.string().trim().min(10, "Опишите проблему подробнее (мин. 10 символов)"),
  pageUrl: z.string().max(2000).default(""),
  userAgent: z.string().max(1000).default(""),
  viewport: z.string().max(50).default(""),
});

export type SubmitSupportReportResult =
  | { ok: true; issueUrl: string | null }
  | { ok: false; error: string };

function attachmentTtlSeconds(): number {
  const raw = Number(process.env.SUPPORT_ATTACHMENT_TTL);
  return Number.isFinite(raw) && raw > 0 ? raw : 30 * 24 * 60 * 60; // 30 дн.
}

function sanitizeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";
}

export async function submitSupportReport(
  formData: FormData,
): Promise<SubmitSupportReportResult> {
  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Не авторизован" };

  const parsed = SchemaInput.safeParse({
    category: formData.get("category"),
    description: formData.get("description"),
    pageUrl: formData.get("pageUrl") ?? "",
    userAgent: formData.get("userAgent") ?? "",
    viewport: formData.get("viewport") ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Некорректные данные формы",
    };
  }
  const input = parsed.data;
  const category = input.category as SupportCategory;

  const supabase = await createClient();

  // ─── Rate-limit: не больше RATE_LIMIT_PER_HOUR репортов в час ───────────
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("support_reports")
    .select("id", { count: "exact", head: true })
    .gte("created_at", hourAgo);
  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return {
      ok: false,
      error: "Слишком много обращений за последний час. Попробуйте позже.",
    };
  }

  const accountId = await getCachedActiveAccountId();

  // ─── Вложение (опционально) ────────────────────────────────────────────
  let attachmentUrl: string | null = null;
  let attachmentName: string | null = null;
  const file = formData.get("attachment");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) {
      return { ok: false, error: "Файл больше 25 МБ" };
    }
    attachmentName = file.name;
    const path = `${user.id}/${crypto.randomUUID()}-${sanitizeName(file.name)}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, {
        contentType: file.type || "application/octet-stream",
      });
    if (upErr) {
      return { ok: false, error: `Не удалось загрузить файл: ${upErr.message}` };
    }
    // Подписанную ссылку минтим service-role клиентом (обходит RLS),
    // чтобы она работала из GitHub-issue / письма независимо от сессии.
    const admin = createAdminClient();
    const { data: signed } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(path, attachmentTtlSeconds());
    attachmentUrl = signed?.signedUrl ?? null;
  }

  // ─── Сборка содержимого ────────────────────────────────────────────────
  const context: SupportContext = {
    userEmail: user.email ?? "—",
    accountId,
    pageUrl: input.pageUrl || "—",
    userAgent: input.userAgent || "—",
    viewport: input.viewport || "—",
    submittedAt: new Date().toISOString(),
  };
  const ttlDays = Math.round(attachmentTtlSeconds() / 86400);
  const body = buildIssueBody({
    description: input.description,
    category,
    context,
    attachmentUrl,
    attachmentName,
    attachmentTtlDays: attachmentUrl ? ttlDays : undefined,
  });
  const title = buildIssueTitle(category, input.description);

  // ─── GitHub issue (best-effort) ────────────────────────────────────────
  let issueUrl: string | null = null;
  if (isGithubConfigured()) {
    try {
      const issue = await createSupportIssue({
        title,
        body,
        labels: issueLabels(category),
      });
      issueUrl = issue.url;
    } catch (err) {
      console.error("[support] GitHub issue failed:", err);
    }
  }

  // ─── Email разработчику (гарантированный канал) ─────────────────────────
  let emailSent = false;
  if (isMailerConfigured()) {
    const to =
      process.env.SUPPORT_INBOX_EMAIL ?? "chillingmoscow@gmail.com";
    try {
      await sendMail({
        to,
        subject: title,
        html: buildSupportEmailHtml(body, issueUrl),
      });
      emailSent = true;
    } catch (err) {
      console.error("[support] support email failed:", err);
    }
  }

  // ─── Аудит / rate-limit log (файл и запись не теряем даже при фейле) ────
  await supabase.from("support_reports").insert({
    user_id: user.id,
    account_id: accountId,
    category,
    github_issue_url: issueUrl,
  });

  if (!issueUrl && !emailSent) {
    return {
      ok: false,
      error:
        "Не удалось доставить обращение. Мы сохранили его и разберёмся вручную.",
    };
  }

  return { ok: true, issueUrl };
}

/** Минимальный HTML-конверт вокруг markdown-тела для письма. */
function buildSupportEmailHtml(markdownBody: string, issueUrl: string | null): string {
  const escaped = markdownBody
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const issueLine = issueUrl
    ? `<p><a href="${issueUrl}">Открыть issue на GitHub</a></p>`
    : "";
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">
${issueLine}
<pre style="white-space:pre-wrap;font-family:ui-monospace,monospace;background:#f6f8fa;padding:12px;border-radius:8px">${escaped}</pre>
</div>`;
}
