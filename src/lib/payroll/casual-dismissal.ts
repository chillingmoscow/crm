import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { LeaseLostError, leasedUpdate } from "@/lib/people/job-lease";
import { removeStaffFromQuickResto, type TerminationSteps } from "@/lib/people/termination-remote";
import {
  checked,
  quickRestoRemovalMessage,
  quickRestoRemovalTransport,
  removeFromChatsJournaled,
  reportRemoval,
  telegramStep,
  TelegramStepError,
  type ChatRemovalJob,
} from "@/lib/people/termination-io";

type Job = {
  id: string;
  account_id: string;
  employee_id: string;
  quickresto_employee_id: number | null;
  telegram_id: string | null;
  steps: TerminationSteps;
  attempts: number;
  name: string | null;
};

const TABLE = "payroll_casual_dismissals";

/**
 * Увольнение разового: удаляет его сотрудника Quick Resto (с привязками к
 * складам), исключает из всех чатов организации и пишет отчёт в чат отчётов —
 * тем же путём, что и увольнение штатного. Возвращает false, если задание
 * взять нельзя (уже выполняется или выполнено).
 */
export async function processCasualDismissal(id?: string) {
  const db = asLooseDb(createAdminClient());
  const job = checked(await db.rpc("payroll_casual_claim_dismissal", { p_id: id ?? null })) as Job | null;
  if (!job) return false;
  const save = async () => {
    await leasedUpdate(db, TABLE, job, {
      steps: job.steps,
      lease_until: new Date(Date.now() + 300000).toISOString(),
    });
  };
  // У разового нет учётной записи: в журнале чатов он записан идентификатором
  // своей записи в зарплате — так же, как в приглашениях.
  const chats: ChatRemovalJob = {
    accountId: job.account_id,
    userId: job.employee_id,
    eventKey: `casual-dismissal:${job.id}`,
    telegramId: job.telegram_id,
    steps: job.steps,
  };
  const telegram = (step: () => Promise<void>) => telegramStep(step, (e) => e instanceof LeaseLostError);
  try {
    await save();
    if (job.quickresto_employee_id !== null)
      await removeStaffFromQuickResto({
        ids: { employeeId: job.quickresto_employee_id, guestId: null, bonusId: null },
        done: job.steps,
        save,
        transport: await quickRestoRemovalTransport(db, job.account_id),
      });
    if (!job.steps.telegram) {
      await save();
      await telegram(() => removeFromChatsJournaled(db, chats, save));
      job.steps.telegram = true;
      await save();
    }
    if (!job.steps.telegram_report) {
      let sent = false;
      await telegram(async () => {
        sent = await reportRemoval(db, chats, `${job.name ?? "Сотрудник"} (разовый)`);
      });
      job.steps.telegram_report = true;
      if (!sent) job.steps.telegram_report_skipped = true;
      await save();
    }
    await leasedUpdate(db, TABLE, job, {
      state: "complete",
      completed_at: new Date().toISOString(),
      error: null,
      lease_until: null,
      steps: job.steps,
    });
    return true;
  } catch (error) {
    if (error instanceof LeaseLostError) throw error;
    let message = error instanceof Error ? error.message : "Не удалось закрыть внешний доступ";
    if (!(error instanceof TelegramStepError)) message = quickRestoRemovalMessage(message);
    await leasedUpdate(db, TABLE, job, {
      state: "error",
      error: message.slice(0, 1500),
      lease_until: null,
      steps: job.steps,
      available_at: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** job.attempts)).toISOString(),
    });
    throw new Error(message);
  }
}

/** Cron: одно задание за тик, как у штатных. */
export async function processCasualDismissals() {
  try {
    return { processed: (await processCasualDismissal()) ? 1 : 0, errors: 0 };
  } catch {
    return { processed: 0, errors: 1 };
  }
}
