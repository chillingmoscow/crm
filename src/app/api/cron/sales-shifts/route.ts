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
import {
  scheduleStockWriteoffs,
  processStockWriteoff,
} from "@/lib/stock/writeoff-sync";
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
    let slices = 0,
      failed = 0,
      monthReports = 0,
      monthReportErrors = 0,
      additionalReports = 0,
      additionalErrors = 0,
      stockSlices = 0,
      stockErrors = 0;
    try {
      await scheduleStatisticsReports();
    } catch {
      monthReportErrors++;
    }
    try {
      await scheduleAdditionalReports();
    } catch {
      additionalErrors++;
    }
    try {
      await scheduleStockWriteoffs();
    } catch {
      stockErrors++;
    }
    // One provider workload per tick: a slow two-report day must not be appended
    // to 25 seconds of order imports and a monthly report in the same request.
    const lane = Math.floor(Date.now() / 15000) % 4;
    if (lane === 3) {
      try {
        const r = await processStockWriteoff();
        if (!r.idle) stockSlices++;
        if (r.error) stockErrors++;
      } catch {
        stockErrors++;
      }
    } else if (lane === 2) {
      try {
        const r = await processAdditionalReport();
        if (!r.idle) additionalReports++;
        if (r.error) additionalErrors++;
      } catch {
        additionalErrors++;
      }
    } else if (lane === 1) {
      try {
        const r = await processStatisticsReport();
        if (!r.idle) monthReports++;
        if (r.error) monthReportErrors++;
      } catch {
        monthReportErrors++;
      }
    } else {
      const started = Date.now();
      while (Date.now() - started < 25000 && slices < 100) {
        const r = await runOneSlice();
        if (r.idle) break;
        slices++;
        if (r.error) {
          failed++;
          break;
        }
      }
    }
    return NextResponse.json({
      queued,
      slices,
      failed,
      monthReports,
      monthReportErrors,
      additionalReports,
      additionalErrors,
      stockSlices,
      stockErrors,
    });
  } catch {
    return NextResponse.json(
      { error: "Не удалось обработать очередь смен" },
      { status: 500 },
    );
  }
}
