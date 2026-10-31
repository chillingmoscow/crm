import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
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
import {
  scheduleSettlements,
  processSettlement,
} from "@/lib/sales/settlement-sync";
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
      stockErrors = 0,
      settlementSlices = 0,
      settlementErrors = 0;
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
    try {
      await scheduleSettlements();
    } catch {
      settlementErrors++;
    }
    // One provider workload per tick: a slow two-report day must not be appended
    // to 25 seconds of order imports and a monthly report in the same request.
    // Persist rotation: a once-per-minute scheduler would otherwise always pick
    // the same lane with a clock modulo divisible by four.
    const rotation = await asLooseDb(createAdminClient()).rpc(
      "sales_next_worker_lane",
    );
    if (
      rotation.error ||
      !Number.isInteger(rotation.data) ||
      Number(rotation.data) < 0 ||
      Number(rotation.data) > 4
    )
      throw new Error("Не удалось выбрать очередь");
    const lane = Number(rotation.data);
    if (lane === 4) {
      const started = Date.now();
      while (Date.now() - started < 25000 && settlementSlices < 100) {
        try {
          const r = await processSettlement();
          if (r.idle) break;
          settlementSlices++;
          if (r.error) {
            settlementErrors++;
            break;
          }
        } catch {
          settlementErrors++;
          break;
        }
      }
    } else if (lane === 3) {
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
      settlementSlices,
      settlementErrors,
    });
  } catch {
    return NextResponse.json(
      { error: "Не удалось обработать очередь смен" },
      { status: 500 },
    );
  }
}
