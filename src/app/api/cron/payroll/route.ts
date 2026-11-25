import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processPayrollDay, schedulePayroll } from "@/lib/payroll/sync";
import {
  scheduleAutomationComparisons,
  processAutomationComparison,
} from "@/lib/automations/worker";
import { processPayrollBonus } from "@/lib/payroll/bonus-worker";
import { processAdjustmentNotification } from "@/lib/payroll/adjustment-notify-worker";
import { processScheduleTasks } from "@/lib/schedule/tasks-worker";
import { processStockCountCommits } from "@/lib/stock-count/commit-worker";
import { processAdeskSync } from "@/lib/payroll/adesk-worker";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "Обработчик не настроен" },
      { status: 503 },
    );
  const a = Buffer.from(secret),
    b = Buffer.from(request.headers.get("x-cron-secret") ?? "");
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return NextResponse.json({ error: "Нет доступа" }, { status: 401 });
  try {
    let taskResult: {created:number;settled:number}|null = null;
    let taskErrors = 0;
    try { taskResult = await processScheduleTasks(); } catch { taskErrors++; }
    // A Quick Resto outage must not stop salary processing; failed weighings retry with backoff.
    let stockCounts: { done: number; failed: number } | null = null;
    let stockCountErrors = 0;
    try {
      stockCounts = await processStockCountCommits();
      stockCountErrors += stockCounts.failed;
    } catch (error) {
      console.error("[cron payroll] проведение взвешиваний не удалось", error instanceof Error ? error.message : error);
      stockCountErrors++;
    }
    await schedulePayroll();
    const started = Date.now();
    let processed = 0,
      errors = 0;
    while (Date.now() - started < 20000) {
      const r = await processPayrollDay();
      if (r.idle) break;
      processed++;
      if (r.error) {
        errors++;
        break;
      }
    }
    // A comparison outage must not stop the existing salary queue.
    let automationComparisons = 0,
      automationErrors = 0;
    try {
      await scheduleAutomationComparisons();
      const comparisonStarted = Date.now();
      while (Date.now() - comparisonStarted < 5000) {
        const r = await processAutomationComparison();
        if (r.idle) break;
        automationComparisons++;
        if (r.error) {
          automationErrors++;
          break;
        }
      }
    } catch {
      automationErrors++;
    }
    let bonusProcessed = 0,
      bonusErrors = 0;
    try {
      const bonus = await processPayrollBonus();
      if (!bonus.idle) bonusProcessed++;
      if ("review" in bonus && bonus.review) bonusErrors++;
    } catch {
      bonusErrors++;
    }
    // A chat outage must not affect salary or bonus processing.
    let finesSent = 0,
      finesErrors = 0;
    try {
      const finesStarted = Date.now();
      while (Date.now() - finesStarted < 5000) {
        const r = await processAdjustmentNotification();
        if (r.idle) break;
        if (r.sent) finesSent++;
        // Stop on the first error: an outage must not burn attempts on every due row in one tick.
        if (r.error) {
          finesErrors++;
          break;
        }
      }
    } catch {
      finesErrors++;
    }
    // An Adesk outage must not affect salary processing; failed payouts retry with backoff.
    let adeskSynced = 0,
      adeskErrors = 0;
    try {
      const adeskStarted = Date.now();
      while (Date.now() - adeskStarted < 8000) {
        const r = await processAdeskSync();
        if (r.idle) break;
        if (r.synced) adeskSynced++;
        if (r.error) {
          adeskErrors++;
          break;
        }
      }
    } catch {
      adeskErrors++;
    }
    return NextResponse.json({
      adeskSynced,
      adeskErrors,
      tasks: taskResult,
      taskErrors,
      stockCounts,
      stockCountErrors,
      finesSent,
      finesErrors,
      bonusProcessed,
      bonusErrors,
      processed,
      errors,
      automationComparisons,
      automationErrors,
    });
  } catch {
    return NextResponse.json(
      { error: "Ошибка обработки зарплаты" },
      { status: 500 },
    );
  }
}
