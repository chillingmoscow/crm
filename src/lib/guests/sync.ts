import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { financeSource } from "@/lib/sales/finance-source";
import { businessDate } from "@/lib/sales/time";
import { SalesRateLimitError } from "@/lib/sales/rate-limit";
import { advanceGuestReader, type GuestReaderJob } from "./source";
type Job = GuestReaderJob & {
  id: string;
  account_id: string;
  venue_id: string;
  lease: string;
  request: { timezone: string; dayStartHour: number };
};
export async function scheduleGuestReads() {
  const result = await asLooseDb(createAdminClient()).rpc("crm_guest_schedule");
  if (result.error) throw Error("Не удалось запланировать чтение гостей");
  return Number(result.data ?? 0);
}
/** Reads the existing provider; never changes customers, groups, bonus balances,
 * transactions or Telegram. Manual CRM fields are preserved by publication. */
export async function processGuestRead() {
  const db = asLooseDb(createAdminClient()),
    claim = await db.rpc("crm_guest_claim");
  if (claim.error) throw Error("Не удалось получить чтение гостей");
  const job = claim.data as Job | null;
  if (!job) return { idle: true };
  try {
    const { source, provider } = await financeSource({
      ...job,
      business_date: businessDate(
        new Date(),
        job.request.timezone,
        job.request.dayStartHour,
      ),
      provider: job.payload.provider,
    });
    const result = await advanceGuestReader(
      { ...job, payload: { ...job.payload, provider } },
      { guests: source.guests, groups: source.guestGroups },
    );
    const saved =
      "publish" in result
        ? await db.rpc("crm_guest_publish", {
            p_job: job.id,
            p_lease: job.lease,
            p_facts: result.publish,
            p_provider: provider,
            p_groups: result.groups,
            p_verified_groups: result.verifiedGroups,
          })
        : await db.rpc("crm_guest_save_slice", {
            p_job: job.id,
            p_lease: job.lease,
            p_phase: result.phase,
            p_cursor: result.cursor,
            p_payload: result.payload,
          });
    if (saved.error) throw Error(saved.error.message);
    return { id: job.id, phase: job.phase, published: "publish" in result };
  } catch (e) {
    const limited = e instanceof SalesRateLimitError;
    const message =
      e instanceof Error && e.name !== "ZodError"
        ? e.message
        : "Не удалось проверить данные гостей";
    const failed = await db.rpc("crm_guest_fail", {
      p_job: job.id,
      p_lease: job.lease,
      p_message: message,
      p_retry_seconds: limited ? Math.ceil(e.retryAfterMs / 1000) : null,
    });
    if (failed.error)
      throw Error("Не удалось сохранить состояние чтения гостей");
    return { id: job.id, error: message };
  }
}
