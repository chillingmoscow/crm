import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { runPayoutChecks } from "@/lib/payroll/payout-check";

/**
 * POST /api/cron/payroll-payout-check
 *
 * Утренняя проверка выплат зарплаты: раз в день в 10:00 по Москве
 * (`scripts/crm-payroll-payout-check.sh`), на следующее утро после выдачи.
 * Сверка выданного по плану с изъятиями из кассы Quick Resto, напоминание о
 * невнесённой выплате переводом, автоперенос остатка месяца после второй
 * выплаты. Что требует человека — карточка «Финансы → На разбор» и сообщение
 * в чат отчётов.
 *
 * Повтор в тот же день безопасен: сошедшийся день не сверяется второй раз,
 * карточка заводится один раз, перенос — по ключу план + сотрудник.
 *
 * 500 — проверка упала или о проблеме никто не узнает (ни карточки, ни отчёта).
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
    const results = await runPayoutChecks();
    const bad = results.some((r) => r.errors.length > 0 || r.unseen);
    if (bad) console.error("[payroll-payout-check] требуется внимание:", JSON.stringify(results));
    return NextResponse.json({ results, timestamp: new Date().toISOString() }, { status: bad ? 500 : 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    console.error(`[payroll-payout-check] ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
