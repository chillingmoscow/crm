import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { runPayoutAuto } from "@/lib/payroll/payout-auto";

/**
 * POST /api/cron/payroll-payouts
 *
 * Автовыдача зарплаты по утверждённому плану выплат: раз в день в 14:00 по
 * Москве (`scripts/crm-payroll-payouts.sh`). Для заведений, где автовыдача
 * включена в «Графике выплат», — строки плана на сегодня: кассы Quick Resto,
 * распределение, проведение с кэшбокса, сообщение в чат менеджеров.
 *
 * Идемпотентность: ключ выдачи — план + день. Повторный запуск в тот же день
 * находит выдачу по ключу и только досылает сообщение, если оно не ушло.
 *
 * Auth: shared-secret из ENV, как у остальных cron-маршрутов.
 */
export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const provided = request.headers.get("x-cron-secret");
  const a = Buffer.from(provided ?? "");
  const b = Buffer.from(expected);
  if (!provided || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const results = await runPayoutAuto();
    // 500 — что-то требует человека, а отчёт до чата отчётов не дошёл, или запуск упал:
    // лог хоста и мониторинг должны это заметить.
    const unseen = results.some((r) => r.outcome === "error" || (r.attention && r.reportSent === false));
    if (unseen) console.error("[payroll-payouts] требуется внимание:", JSON.stringify(results));
    return NextResponse.json({ results, timestamp: new Date().toISOString() }, { status: unseen ? 500 : 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    console.error(`[payroll-payouts] ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
