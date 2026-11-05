import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { loadTelegramBot } from "@/lib/integrations/telegram-bot";
import { telegramMessageReceipt } from "@/lib/integrations/telegram-response";
import { escapeHtml } from "@/lib/payroll/adjustment-notify";
type Message = {
  id: string;
  lease_token: string;
  account_id: string;
  chat_id: string;
  kind: "daily" | "monday" | "wednesday";
  payload: { name: string; employee: string | null; blocked: string }[];
};
export async function processTaskMessage() {
  const db = asLooseDb(createAdminClient());
  const r = await db.rpc("schedule_claim_task_message");
  if (r.error) throw new Error(r.error.message);
  const job = r.data as Message | null;
  if (!job) return { idle: true };
  const finish = async (
    message: number | null,
    error: string | null,
    uncertain = false,
  ) => {
    for (let i = 0; i < 3; i++) {
      const r = await db.rpc("schedule_finish_task_message", {
        p_id: job.id,
        p_lease: job.lease_token,
        p_message: message,
        p_error: error,
        p_uncertain: uncertain,
      });
      if (!r.error) return;
    }
    throw new Error("Не удалось записать результат отправки");
  };
  let sent = false;
  try {
    const bot = await loadTelegramBot(db, job.account_id);
    if (!bot) {
      await finish(null, "Telegram не настроен");
      return { idle: false, error: true };
    }
    const base = (
      process.env.NEXT_PUBLIC_SITE_URL || "https://sheerly.app"
    ).replace(/\/$/, "");
    const link = `<a href="${escapeHtml(base)}/schedule?tab=tasks">Открыть задачи в Sheerly</a>`;
    const text =
      job.kind === "daily"
        ? `✅ <b>Задачи на сегодня</b>\n\n${job.payload.map((t) => `• ${escapeHtml(t.name)} — ${escapeHtml(t.employee || "без назначения")}${t.blocked ? " (нужна проверка назначения)" : ""}`).join("\n")}\n\nЗаполните чек-листы и приложите фотографии к нужным пунктам.\n${link}`
        : job.kind === "monday"
          ? `🗓️ <b>Время составлять график!</b>\n\nОбсудите расписание на следующую неделю и через одну с коллегами своего подразделения. Срок сдачи — до среды включительно. Затем старшие подразделений составляют график.\n\n<a href="${escapeHtml(base)}/schedule">График в Sheerly</a>`
          : `⏳ <b>Сегодня последний день сдачи графика!</b>\n\nПередайте расписание на следующую неделю сегодня, согласовав замены и пожелания. После среды старшие подразделений составляют график.\n\n<a href="${escapeHtml(base)}/schedule">График в Sheerly</a>`;
    // Never split a message after a partial delivery. Oversize lists link to the complete calendar.
    const body =
      text.length > 3900
        ? `✅ <b>Задачи на сегодня</b>\n\nЗаданий: ${job.payload.length}. Полный список и чек-листы доступны в Sheerly.\n${link}`
        : text;
    const result = await bot.sendMessage(job.chat_id, body, undefined, {
      html: true,
    });
    const receipt = telegramMessageReceipt(result);
    if (receipt.messageId === null) {
      await finish(
        null,
        result.description ||
          "Ответ Telegram не подтверждён. Проверьте чат перед повтором",
        receipt.uncertain,
      );
      return { idle: false, error: true };
    }
    sent = true;
    await finish(receipt.messageId, null);
    return { idle: false, sent: true };
  } catch {
    if (!sent)
      await finish(
        null,
        "Ответ Telegram не подтверждён. Проверьте чат перед повтором",
        true,
      );
    return { idle: false, error: true, sent };
  }
}
