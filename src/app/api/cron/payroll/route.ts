import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processPayrollDay, schedulePayroll } from "@/lib/payroll/sync";
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
    return NextResponse.json({ processed, errors });
  } catch {
    return NextResponse.json(
      { error: "Ошибка обработки зарплаты" },
      { status: 500 },
    );
  }
}
