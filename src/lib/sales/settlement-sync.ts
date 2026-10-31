import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { getConnection, salesSource } from "./quickresto";
import { salesSettingsColumns, type SalesSettings } from "./types";
import { SalesRateLimitError } from "./rate-limit";
import {
  advanceSettlementReader,
  SettlementSourceChanged,
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
    const r = await db
      .from<SalesSettings>("sales_settings")
      .select(salesSettingsColumns)
      .eq("account_id", j.account_id)
      .eq("venue_id", j.venue_id)
      .single();
    if (r.error || !r.data) throw new Error("Источники продаж не настроены");
    const s = r.data;
    if (
      s.timezone !== j.request.timezone ||
      s.day_start_hour !== j.request.dayStartHour
    )
      throw new SettlementSourceChanged();
    // Match the sales reader's current single-venue source guard. Do not infer
    // receipt ownership from a venue name or reuse one layer for several venues.
    if (s.quickresto_venue_id)
      throw new Error(
        "Сначала подтвердите привязку чеков Quick Resto к заведению",
      );
    const [links, other] = await Promise.all([
      db
        .from<{ id: string }[]>("external_entity_links")
        .select("id")
        .eq("account_id", j.account_id)
        .eq("provider", "quickresto")
        .eq("entity_type", "venue"),
      db
        .from<{ venue_id: string }[]>("sales_settings")
        .select("venue_id")
        .eq("account_id", j.account_id)
        .eq("enabled", true)
        .neq("venue_id", j.venue_id),
    ]);
    if (links.error || other.error)
      throw new Error("Не удалось проверить принадлежность чеков");
    if ((links.data?.length ?? 0) > 1 || other.data?.length)
      throw new Error(
        "Нужна подтверждённая привязка подключения к одному заведению",
      );
    const connection = await getConnection(j.account_id);
    if (!connection) throw new Error("Подключите Quick Resto");
    const provider = createHash("sha256")
      .update(
        JSON.stringify([
          connection.login,
          connection.backoffice_base_url ?? null,
        ]),
      )
      .digest("hex");
    if (j.payload.provider && j.payload.provider !== provider)
      throw new SettlementSourceChanged();
    const result = await advanceSettlementReader(
      { ...j, payload: { ...j.payload, provider } },
      salesSource(connection, s, j.business_date),
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
