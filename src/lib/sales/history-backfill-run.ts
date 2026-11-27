import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { HISTORY_FROM, historyDayToEnqueue, type HistoryDay } from "./history-backfill";
import { zonedParts } from "./time";
import { enqueueDay } from "./sync";

/**
 * Один прошлый день в очередь каждому заведению с включённой загрузкой продаж,
 * если его очередь пуста. Выключается `SALES_HISTORY_BACKFILL=off`.
 */
export async function scheduleHistoryDay(): Promise<{ venueId: string; date: string | null }[]> {
  if (process.env.SALES_HISTORY_BACKFILL === "off") return [];
  const q = asLooseDb(createAdminClient());
  const venues = await q.from<{ account_id: string; venue_id: string; timezone: string | null }[]>("sales_settings").select("account_id,venue_id,timezone").eq("enabled", true);
  if (venues.error) throw new Error(venues.error.message);
  const out: { venueId: string; date: string | null }[] = [];
  for (const v of venues.data ?? []) {
    // Только ночью (02:00–09:00 по заведению): лимит запросов Quick Resto общий на
    // аккаунт, и упор в него днём задержал бы загрузку сегодняшних смен.
    const hour = zonedParts(new Date(), v.timezone ?? "Europe/Moscow").hour;
    if (hour < 2 || hour >= 9) {
      out.push({ venueId: v.venue_id, date: null });
      continue;
    }
    const busy = await q.from<{ id: string }[]>("sales_sync_jobs").select("id")
      .eq("venue_id", v.venue_id).in("status", ["queued", "running"]).limit(1);
    if (busy.error) throw new Error(busy.error.message);
    type Row = { business_date: string; status: string; sync_error: string | null; turnover: number | null };
    const rows = await fetchAllRows<Row>(() =>
      q.from<Row[]>("sales_days").select("business_date,status,sync_error,turnover:calculated->turnover").eq("venue_id", v.venue_id).gte("business_date", HISTORY_FROM));
    const days = new Map<string, HistoryDay>(rows.map((d) => [
      d.business_date.slice(0, 10),
      d.sync_error && d.status !== "complete" ? "error" : !Number(d.turnover) ? "empty" : "ok",
    ]));
    const first = [...days].filter(([, s]) => s !== "error").map(([d]) => d).sort()[0];
    const failed = first
      ? await fetchAllRows<{ business_date: string }>(() =>
          q.from<{ business_date: string }[]>("sales_sync_jobs").select("business_date")
            .eq("venue_id", v.venue_id).eq("status", "failed").gte("business_date", HISTORY_FROM).lt("business_date", first))
      : [];
    const failedTimes = new Map<string, number>();
    for (const f of failed) failedTimes.set(f.business_date.slice(0, 10), (failedTimes.get(f.business_date.slice(0, 10)) ?? 0) + 1);
    const date = historyDayToEnqueue({ days, failedTimes, busy: (busy.data ?? []).length > 0 });
    if (date) await enqueueDay(v.account_id, v.venue_id, date);
    out.push({ venueId: v.venue_id, date });
  }
  return out;
}
