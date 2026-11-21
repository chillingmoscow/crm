import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/cron/finance-recurring
 *
 * Ежедневный cron — порождает ожидаемые платежи повторяющихся шаблонов
 * («Финансы → На разбор») за наступившие сроки во всех аккаунтах.
 *
 * Идемпотентность: `finance_recurring_materialize_all` (миграция 378) создаёт
 * записи только для сроков, по которым их ещё нет (`UNIQUE (template_id,
 * due_date)`), и считает «сегодня» в поясе каждого аккаунта. Повторный запуск
 * в тот же день ничего не добавляет. Страховка от молчащего cron — очередь
 * «На разбор» при открытии порождает сроки своего аккаунта сама.
 *
 * Функция доступна только service_role — вызываем admin-клиентом.
 *
 * Запуск на хосте — `scripts/crm-finance-recurring.sh` (копия
 * /usr/local/bin/crm-finance-recurring) из /etc/cron.d/crm-finance-recurring
 * в 00:05 по Москве. Как crm-module-workers, он зовёт маршрут изнутри
 * контейнера: CRON_SECRET живёт только в окружении приложения.
 *
 * Auth: shared-secret из ENV — как medical-book-expiry-notifications.
 */
export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const provided = request.headers.get("x-cron-secret");
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("finance_recurring_materialize_all");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    enqueued: Number(data ?? 0),
    timestamp: new Date().toISOString(),
  });
}
