import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { getConnection, salesSource } from "./quickresto";
import {
  parseAdditionalReports,
  type AdditionalKind,
  type AdditionalRules,
} from "./additional";
import { dayWindow } from "./time";
import { salesSettingsColumns, type SalesSettings } from "./types";
import { SalesRateLimitError } from "./rate-limit";

export async function scheduleAdditionalReports() {
  const r = await asLooseDb(createAdminClient()).rpc(
    "sales_schedule_additional_reports",
  );
  if (r.error) throw new Error("Не удалось запланировать допродажи");
  return Number(r.data ?? 0);
}
/** Read-only provider calls and a statistics checkpoint. No financial/payroll writes. */
export async function processAdditionalReport(venueId?: string) {
  const db = asLooseDb(createAdminClient());
  const result = await db.rpc("sales_claim_additional_report", {
    p_venue: venueId ?? null,
  });
  if (result.error) throw new Error("Не удалось получить задание допродаж");
  const job = result.data as {
    id: string;
    account_id: string;
    venue_id: string;
    date: string;
    kind: AdditionalKind;
    lease_token: string;
    request: {
      report_id: number;
      cocktail_report_id: number;
      start: number;
      end: number;
      timezone: string;
      hour: number;
      rules: AdditionalRules;
    };
  } | null;
  if (!job) return { idle: true };
  try {
    const window = dayWindow(job.date, job.request.timezone, job.request.hour);
    if (
      window.start !== job.request.start ||
      window.end - 1 !== job.request.end ||
      job.request.end >= Date.now()
    )
      throw new Error("Проверьте рабочий период допродаж");
    const config = await db
      .from<SalesSettings>("sales_settings")
      .select(salesSettingsColumns)
      .eq("account_id", job.account_id)
      .eq("venue_id", job.venue_id)
      .single();
    if (config.error || !config.data) throw new Error("Продажи не настроены");
    const connection = await getConnection(job.account_id);
    if (!connection) throw new Error("Не настроено подключение");
    const source = salesSource(
      connection,
      {
        ...config.data,
        timezone: job.request.timezone,
        day_start_hour: job.request.hour,
      },
      job.date,
    );
    const raw = await source.statisticsReport(
      job.request.report_id,
      job.request,
    );
    const cocktail =
      job.kind === "bar"
        ? await source.statisticsReport(
            job.request.cocktail_report_id,
            job.request,
          )
        : undefined;
    const metrics = parseAdditionalReports(
      job.kind,
      raw,
      cocktail,
      job.request.rules,
    );
    const saved = await db.rpc("sales_commit_additional_report", {
      p_id: job.id,
      p_lease: job.lease_token,
      p_metrics: metrics,
    });
    if (saved.error) throw new Error("Не удалось сохранить допродажи");
    return { idle: false, superseded: !saved.data };
  } catch (error) {
    const limited =
      error instanceof SalesRateLimitError ||
      (error instanceof Error && /\b429\b/.test(error.message));
    const message = limited
      ? "Quick Resto ограничил частоту запросов. Повторим позже."
      : error instanceof Error &&
          /^Quick Resto (не вернул|вернул некорректн)/.test(error.message)
        ? error.message
        : "Не удалось получить допродажи. Повторим автоматически.";
    const failed = await db.rpc("sales_fail_additional_report", {
      p_id: job.id,
      p_lease: job.lease_token,
      p_error: message,
      p_retry_ms: limited
        ? error instanceof SalesRateLimitError
          ? error.retryAfterMs
          : 60000
        : null,
    });
    if (failed.error) throw new Error("Не удалось сохранить ошибку допродаж");
    return { idle: false, error: true };
  }
}
