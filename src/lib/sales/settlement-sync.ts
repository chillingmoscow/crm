import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { financeSource } from "./finance-source";
import { SalesRateLimitError } from "./rate-limit";
import {
  advanceSettlementReader,
  type SettlementReaderJob,
} from "./settlement-reader";

type Job = SettlementReaderJob & {
  id: string;
  account_id: string;
  venue_id: string;
  lease: string;
};
export async function scheduleSettlements() {
  const r = await asLooseDb(createAdminClient()).rpc(
    "finance_schedule_settlements",
  );
  if (r.error) throw new Error("Не удалось запланировать сверку поступлений");
  return Number(r.data ?? 0);
}
/** Reads only. This worker has no ledger/provider mutation path. */
export async function processSettlement() {
  const db = asLooseDb(createAdminClient());
  const claimed = await db.rpc("finance_claim_settlement_job");
  if (claimed.error) throw new Error("Не удалось получить задание сверки");
  const j = claimed.data as Job | null;
  if (!j) return { idle: true };
  try {
    const { source, provider } = await financeSource({
      ...j,
      provider: j.payload.provider,
    });
    const result = await advanceSettlementReader(
      { ...j, payload: { ...j.payload, provider } },
      source,
    );
    const saved =
      "publish" in result
        ? await db.rpc("finance_publish_settlement", {
            p_job: j.id,
            p_lease: j.lease,
            p_facts: result.publish.facts,
            p_methods: result.publish.methods,
            p_summary: result.publish.summary,
          })
        : await db.rpc("finance_save_settlement_slice", {
            p_job: j.id,
            p_lease: j.lease,
            p_phase: result.phase,
            p_cursor: result.cursor,
            p_payload: result.payload,
          });
    if (saved.error) throw new Error(saved.error.message);
    return { id: j.id, phase: j.phase };
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Не удалось прочитать поступления";
    const limited = e instanceof SalesRateLimitError || /\b429\b/.test(message);
    const failed = await db.rpc("finance_fail_settlement", {
      p_job: j.id,
      p_lease: j.lease,
      p_message: message,
      p_retry_seconds: limited
        ? e instanceof SalesRateLimitError
          ? Math.ceil(e.retryAfterMs / 1000)
          : 60
        : null,
    });
    if (failed.error) throw new Error("Не удалось сохранить состояние сверки");
    return { id: j.id, error: message, rateLimited: limited };
  }
}
