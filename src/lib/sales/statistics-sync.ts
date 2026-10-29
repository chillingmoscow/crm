import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { getConnection, salesSource } from "./quickresto";
import {
  parseStatisticsReport,
  statisticsReportWindow,
  type StatisticsReportKind,
} from "./statistics-reports";
import { salesSettingsColumns, type SalesSettings } from "./types";
import { SalesRateLimitError } from "./rate-limit";

export async function scheduleStatisticsReports() {
  const r = await asLooseDb(createAdminClient()).rpc(
    "sales_schedule_month_reports",
  );
  if (r.error) throw new Error("Не удалось запланировать месячные отчёты");
  return Number(r.data ?? 0);
}

/** Only reads Quick Resto and stores aggregate statistics; no receipt/salary/finance writer. */
export async function processStatisticsReport(venueId?: string) {
  const db = asLooseDb(createAdminClient());
  const result = await db.rpc("sales_claim_month_report", {
    p_venue: venueId ?? null,
  });
  if (result.error) throw new Error("Не удалось получить месячный отчёт");
  const job = result.data as {
    id: string;
    account_id: string;
    venue_id: string;
    month: string;
    kind: StatisticsReportKind;
    lease_token: string;
    request: {
      report_id: number;
      start: number;
      end: number;
      timezone: string;
      hour: number;
    };
  } | null;
  if (!job) return { idle: true };
  try {
    const window = statisticsReportWindow(
      job.month.slice(0, 7),
      job.request.timezone,
      job.request.hour,
      new Date(job.request.end + 1),
    );
    if (
      !window ||
      window.start !== job.request.start ||
      window.end !== job.request.end ||
      job.request.end >= Date.now()
    )
      throw new Error("Проверьте рабочий период отчёта");
    const config = await db
      .from<SalesSettings>("sales_settings")
      .select(salesSettingsColumns)
      .eq("account_id", job.account_id)
      .eq("venue_id", job.venue_id)
      .single();
    if (config.error || !config.data) throw new Error("Не настроены продажи");
    const connection = await getConnection(job.account_id);
    if (!connection) throw new Error("Не настроено подключение");
    const settings = {
      ...config.data,
      timezone: job.request.timezone,
      day_start_hour: job.request.hour,
    };
    const raw = await salesSource(
      connection,
      settings,
      job.month,
    ).statisticsReport(job.request.report_id, job.request);
    const metrics = parseStatisticsReport(job.kind, raw);
    const saved = await db.rpc("sales_commit_month_report", {
      p_id: job.id,
      p_lease: job.lease_token,
      p_metrics: metrics,
    });
    if (saved.error) throw new Error("Не удалось сохранить отчёт");
    return { idle: false, superseded: !saved.data };
  } catch (error) {
    const rateLimited =
      error instanceof SalesRateLimitError ||
      (error instanceof Error && /\b429\b/.test(error.message));
    const safeMessage = rateLimited
      ? "Quick Resto ограничил частоту запросов. Повторим позже."
      : error instanceof Error &&
          /^Quick Resto (не вернул|вернул некорректный)/.test(error.message)
        ? error.message
        : "Не удалось получить месячный отчёт. Повторим автоматически.";
    const failed = await db.rpc("sales_fail_month_report", {
      p_id: job.id,
      p_lease: job.lease_token,
      p_error: safeMessage,
      p_retry_ms: rateLimited
        ? error instanceof SalesRateLimitError
          ? error.retryAfterMs
          : 60000
        : null,
    });
    if (failed.error) throw new Error("Не удалось сохранить ошибку отчёта");
    return { idle: false, error: true };
  }
}
