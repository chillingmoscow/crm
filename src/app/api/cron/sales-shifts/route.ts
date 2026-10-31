import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runOneSlice, scheduleDueDays } from "@/lib/sales/sync";
import {
  scheduleAdditionalReports,
  processAdditionalReport,
} from "@/lib/sales/additional-sync";
import {
  scheduleStatisticsReports,
  processStatisticsReport,
} from "@/lib/sales/statistics-sync";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "Обработчик смен не настроен" },
      { status: 503 },
    );
  const expected = Buffer.from(secret),
    actual = Buffer.from(request.headers.get("x-cron-secret") ?? "");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return NextResponse.json({ error: "Нет доступа" }, { status: 401 });
  try {
    const queued = await scheduleDueDays();
    const started = Date.now();
    let slices = 0,
      failed = 0;
    while (Date.now() - started < 25000 && slices < 100) {
      const result = await runOneSlice();
      if (result.idle) break;
      slices++;
      if (result.error) {
        failed++;
        break;
      }
    }
    let monthReports = 0,
      monthReportErrors = 0;
    try {
      await scheduleStatisticsReports();
      const start = Date.now();
      while (Date.now() - start < 5000) {
        const r = await processStatisticsReport();
        if (r.idle) break;
        monthReports++;
        if (r.error) {
          monthReportErrors++;
          break;
        }
      }
    } catch {
      monthReportErrors++;
    }
    let additionalReports = 0,
      additionalErrors = 0;
    try {
      await scheduleAdditionalReports();
      if (Date.now() - started < 30000) {
        const r = await processAdditionalReport();
        if (!r.idle) additionalReports++;
        if (r.error) additionalErrors++;
      }
    } catch {
      additionalErrors++;
    }
    return NextResponse.json({
      queued,
      slices,
      failed,
      monthReports,
      monthReportErrors,
      additionalReports,
      additionalErrors,
    });
  } catch {
    return NextResponse.json(
      { error: "Не удалось обработать очередь смен" },
      { status: 500 },
    );
  }
}
