import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processPayrollDay, schedulePayroll } from "@/lib/payroll/sync";
import {
  scheduleAutomationComparisons,
  processAutomationComparison,
} from "@/lib/automations/worker";
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
    return NextResponse.json({
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
