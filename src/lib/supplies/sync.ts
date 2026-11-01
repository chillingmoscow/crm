import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { financeSource } from "@/lib/sales/finance-source";
import { businessDate } from "@/lib/sales/time";
import { SalesRateLimitError } from "@/lib/sales/rate-limit";
import { advanceSupplyRead, type SupplyReadJob } from "./source";
type Job = SupplyReadJob & {
  id: string;
  account_id: string;
  venue_id: string;
  lease: string;
  source_failures: number;
  request: SupplyReadJob["request"] & { dayStartHour: number };
};
export async function scheduleSupplies() {
  const r = await asLooseDb(createAdminClient()).rpc("supply_schedule");
  if (r.error) throw Error("Не удалось запланировать чтение поставок");
  return Number(r.data ?? 0);
}
/** Read-only mirror. Never creates suppliers, payments, transactions or QR documents. */
export async function processSupplyRead() {
  const db = asLooseDb(createAdminClient()),
    claimed = await db.rpc("supply_claim");
  if (claimed.error) throw Error("Не удалось получить чтение поставок");
  const j = claimed.data as Job | null;
  if (!j) return { idle: true };
  let readingSource = true;
  try {
    const { source, provider } = await financeSource({
      ...j,
      business_date: businessDate(
        new Date(),
        j.request.timezone,
        j.request.dayStartHour,
      ),
      provider: j.payload.provider,
    });
    const next = await advanceSupplyRead(j, {
      page: source.supplyPage,
      financial: source.supplies,
    });
    readingSource = false;
    const saved =
      "publish" in next
        ? await db.rpc("supply_publish", {
            p_job: j.id,
            p_lease: j.lease,
            p_facts: next.publish,
            p_provider: provider,
          })
        : await db.rpc("supply_save_slice", {
            p_job: j.id,
            p_lease: j.lease,
            p_phase: next.phase,
            p_cursor: next.cursor,
            p_payload: { ...next.payload, provider },
          });
    if (saved.error) throw Error(saved.error.message);
    return { id: j.id, published: "publish" in next };
  } catch (e) {
    const limited = e instanceof SalesRateLimitError,
      transient =
        readingSource &&
        e instanceof Error &&
        (/^Quick Resto(?: back-office)? request timed out after \d+s$/.test(
          e.message,
        ) ||
          ["AbortError", "TimeoutError"].includes(e.name) ||
          e.message === "fetch failed"),
      retry = transient && j.source_failures < 3,
      message = transient
        ? retry
          ? "Quick Resto не ответил вовремя. Чтение продолжится автоматически."
          : "Quick Resto несколько раз не ответил вовремя. Запустите обновление позже."
        : e instanceof Error && e.name !== "ZodError"
          ? e.message
          : "Не удалось проверить поля накладной";
    const r = await db.rpc("supply_fail", {
      p_job: j.id,
      p_lease: j.lease,
      p_message: message,
      p_retry_seconds: limited
        ? Math.ceil(e.retryAfterMs / 1000)
        : retry
          ? 30 * 2 ** j.source_failures
          : null,
    });
    if (r.error) throw Error("Не удалось сохранить состояние чтения поставок");
    return { id: j.id, error: message };
  }
}
