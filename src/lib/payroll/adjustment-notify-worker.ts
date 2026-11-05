import "server-only";
import { loadTelegramBot } from "@/lib/integrations/telegram-bot";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { formatAdjustmentMessage, reportDelivered, sendWithPhotoFallback, type NotifyRow } from "./adjustment-notify";

type Claim = NotifyRow & {
  adjustment_id: string;
  account_id: string;
  photo_path: string | null;
  chat_id: string;
};

const CAPTION_LIMIT = 1024;
const clip = (text: string) => text.slice(0, 500);

/** Sends one queued fines-chat notification. Never throws after a claim: the result is reported to the queue. */
export async function processAdjustmentNotification(): Promise<{ idle: boolean; sent?: boolean; error?: string }> {
  const admin = createAdminClient();
  const db = asLooseDb(admin);
  const claimed = await db.rpc("payroll_claim_adjustment_notification");
  if (claimed.error) throw new Error(claimed.error.message);
  const job = claimed.data as Claim | null;
  if (!job) return { idle: true };

  const finish = async (messageId: number | null, error: string | null): Promise<void> => {
    // The send already happened: losing the report would repeat the message after ten minutes.
    let last = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await db.rpc("payroll_finish_adjustment_notification", {
        p_adjustment: job.adjustment_id, p_account: job.account_id,
        p_message_id: messageId, p_error: error === null ? null : clip(error),
      });
      if (!r.error) return;
      last = r.error.message;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(last);
  };
  const fail = async (message: string) => {
    await finish(null, message);
    return { idle: false, sent: false, error: clip(message) };
  };

  try {
    const bot = await loadTelegramBot(db, job.account_id);
    if (!bot) return await fail("Telegram не настроен");

    // Deleted while waiting or in flight: do not announce a removed entry.
    const current = await db.from<{ deleted_at: string | null }>("payroll_adjustments")
      .select("deleted_at").eq("id", job.adjustment_id).eq("account_id", job.account_id).maybeSingle();
    if (current.error) return await fail("Не удалось проверить запись");
    if (!current.data || current.data.deleted_at) {
      const skipped = await db.rpc("payroll_skip_adjustment_notification", {
        p_adjustment: job.adjustment_id, p_account: job.account_id,
      });
      if (skipped.error) throw new Error(skipped.error.message);
      return { idle: false, sent: false };
    }

    const text = formatAdjustmentMessage(job);
    let photoUrl: string | null = null;
    if (job.photo_path) {
      const signed = await admin.storage.from("payroll-photos").createSignedUrl(job.photo_path, 600);
      if (signed.error || !signed.data?.signedUrl) return await fail("Не удалось получить ссылку на фото");
      photoUrl = signed.data.signedUrl;
    }
    // Caption limit: a text longer than 1024 characters cannot be a caption, so it is
    // sent as a plain message and the photo is left out.
    const url = photoUrl && text.length <= CAPTION_LIMIT ? photoUrl : null;
    const sent = await sendWithPhotoFallback(
      url ? () => bot.sendPhoto(job.chat_id, url, text) : null,
      () => bot.sendMessage(job.chat_id, text, undefined, { html: true }),
    );
    if (!sent.ok || typeof sent.result?.message_id !== "number")
      return await fail(sent.description || "Telegram отклонил сообщение");
    // Delivered: from here on never mark the row as failed, that would resend it.
    const messageId = sent.result.message_id;
    return await reportDelivered(() => finish(messageId, null));
  } catch (e) {
    // Messages come from the Telegram client (token-free) or from our own text.
    const message = e instanceof Error && e.message ? e.message : "Ошибка отправки";
    return await fail(message);
  }
}
