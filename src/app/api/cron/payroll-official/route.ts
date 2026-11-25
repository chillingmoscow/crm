import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { writeAuditEvents } from "@/lib/audit/write";
import { processOfficialRun } from "@/lib/payroll/official-run";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/cron/payroll-official
 *
 * Ежедневный cron официальной зарплаты. Для каждого заведения с включённой
 * официальной выплатой, начиная с дня выплаты (настройка заведения, по поясу
 * аккаунта), проводит платежи сотрудников с оформлением за прошлый месяц, а
 * спорные случаи (первый/последний месяц, нет счёта и т.п.) кладёт карточками
 * в «На разбор».
 *
 * Идемпотентность: `payroll_official_run` (миграция 384) берёт только тех, у
 * кого за месяц ещё нет записи `payroll_official_months`, поэтому повторный
 * запуск ничего не дублирует. Функция доступна только service_role.
 *
 * Результат: любой элемент с `error` или непустым `errors` — сбой. Успешная
 * часть всё равно попадает в журнал, ответ — 500 с телом результата, чтобы
 * хостовой скрипт и мониторинг заметили.
 *
 * Запуск на хосте — `scripts/crm-payroll-official.sh`.
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

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("payroll_official_run");
  if (error) {
    console.error(`[payroll-official] payroll_official_run: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const outcome = processOfficialRun(data);
  await writeAuditEvents(outcome.events);

  if (outcome.failed) {
    console.error("[payroll-official] часть заведений отработала с ошибками", JSON.stringify(data));
  }
  return NextResponse.json(
    { ...outcome.totals, result: data, timestamp: new Date().toISOString() },
    { status: outcome.failed ? 500 : 200 },
  );
}
