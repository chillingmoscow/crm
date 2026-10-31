import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { financeSource } from "./finance-source";
import {
  normalizeCashControl,
  sameCashControl,
  type CashControlReport,
} from "./cash-control";
import { SalesRateLimitError } from "./rate-limit";
type Job = {
  id: string;
  account_id: string;
  venue_id: string;
  business_date: string;
  request: { timezone: string; dayStartHour: number };
  provider: string | null;
  candidate: CashControlReport[] | null;
  phase: "first" | "verify";
  lease: string;
};
export async function scheduleCashControls() {
  const r = await asLooseDb(createAdminClient()).rpc("cash_control_schedule");
  if (r.error) throw new Error("Не удалось запланировать контроль кассы");
  return Number(r.data ?? 0);
}
export async function processCashControl() {
  const db = asLooseDb(createAdminClient()),
    claimed = await db.rpc("cash_control_claim");
  if (claimed.error) throw new Error("Не удалось получить проверку кассы");
  const j = claimed.data as Job | null;
  if (!j) return { idle: true };
  try {
    const { source, provider } = await financeSource({
      ...j,
      provider: j.provider ?? undefined,
    });
    const reports = normalizeCashControl(
      await source.cashControlList(),
      j.business_date,
      j.request.timezone,
      j.request.dayStartHour,
    );
    if (
      j.phase === "verify" &&
      (!j.candidate || !sameCashControl(j.candidate, reports))
    )
      throw new Error("Кассовые отчёты изменились во время чтения");
    const saved = await db.rpc("cash_control_save_read", {
      p_job: j.id,
      p_lease: j.lease,
      p_reports: reports,
      p_provider: provider,
    });
    if (saved.error) throw new Error(saved.error.message);
    return { id: j.id, ready: saved.data !== null };
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Не удалось прочитать контроль кассы";
    const limited = e instanceof SalesRateLimitError || /\b429\b/.test(message);
    const r = await db.rpc("cash_control_fail", {
      p_job: j.id,
      p_lease: j.lease,
      p_message: message,
      p_retry_seconds: limited
        ? e instanceof SalesRateLimitError
          ? Math.ceil(e.retryAfterMs / 1000)
          : 60
        : null,
    });
    if (r.error)
      throw new Error("Не удалось сохранить состояние контроля кассы");
    return { id: j.id, error: message, rateLimited: limited };
  }
}
