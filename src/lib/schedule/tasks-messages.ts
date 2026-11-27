import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { loadTelegramBot } from "@/lib/integrations/telegram-bot";
import { telegramMessageReceipt } from "@/lib/integrations/telegram-response";
import { escapeHtml } from "@/lib/payroll/adjustment-notify";
import { scheduleReminderText } from "@/lib/schedule/task-message-schedule";
import { dailyTasksMessage, type DailyTask } from "@/lib/schedule/daily-tasks-message";
type Message = {
  id: string;
  lease_token: string;
  account_id: string;
  chat_id: string;
  business_date: string;
} & (
  | { kind: "daily"; payload: DailyTask[] }
  | {
      kind: "schedule_open" | "schedule_deadline" | "monday" | "wednesday";
      payload: { deadline_day?: number };
    }
);
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
    const body =
      job.kind === "daily"
        ? dailyTasksMessage(job.payload, job.business_date, base)
        : scheduleReminderText(
            job.kind,
            job.payload.deadline_day,
            `<a href="${escapeHtml(base)}/schedule">Расписание в Sheerly</a>`,
          );
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
