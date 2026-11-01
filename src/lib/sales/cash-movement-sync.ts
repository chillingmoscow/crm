import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { financeSource } from "./finance-source";
import {
  normalizeCashMovements,
  sameCashMovements,
  type CashMovement,
} from "./cash-movements";
import { SalesRateLimitError } from "./rate-limit";
type Job = {
  id: string;
  account_id: string;
  venue_id: string;
  business_date: string;
  request: {
    timezone: string;
    dayStartHour: number;
    from: string;
    through: string;
    since: string;
    till: string;
  };
  provider: string | null;
  candidate: CashMovement[] | null;
  phase: "first" | "verify";
  lease: string;
};
export async function scheduleCashMovements() {
  const r = await asLooseDb(createAdminClient()).rpc("cash_movement_schedule");
  if (r.error) throw new Error("Не удалось запланировать кассовые операции");
  return Number(r.data ?? 0);
}
export async function processCashMovement() {
  const db = asLooseDb(createAdminClient()),
    claimed = await db.rpc("cash_movement_claim");
  if (claimed.error)
    throw new Error("Не удалось получить сверку кассовых операций");
  const j = claimed.data as Job | null;
  if (!j) return { idle: true };
  try {
    const { source, provider } = await financeSource({
      ...j,
      provider: j.provider ?? undefined,
    });
    const reports = normalizeCashMovements(
      await source.cashMovements(j.request.since, j.request.till),
      { ...j.request, from: "2000-01-01" },
    );
    if (
      j.phase === "verify" &&
      (!j.candidate || !sameCashMovements(j.candidate, reports))
    )
      throw new Error("Кассовые операции изменились во время чтения");
    const saved = await db.rpc("cash_movement_save_read", {
      p_job: j.id,
      p_lease: j.lease,
      p_items: reports,
      p_provider: provider,
    });
    if (saved.error) throw new Error(saved.error.message);
    return { id: j.id, ready: saved.data !== null };
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Не удалось прочитать кассовые операции";
    const limited = e instanceof SalesRateLimitError || /\b429\b/.test(message);
    const r = await db.rpc("cash_movement_fail", {
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
      throw new Error(
        "Не удалось сохранить состояние сверки кассовых операций",
      );
    return { id: j.id, error: message, rateLimited: limited };
  }
}
