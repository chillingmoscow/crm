import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/cron/medical-book-expiry-notifications
 *
 * Daily cron — пишет `staff.medical_book_expiring` уведомления сотрудникам,
 * у которых медкнижка истекает в ближайшие 30 дней (или уже просрочена) и
 * для текущего значения `medical_book_date` ещё не было отправлено.
 *
 * Идемпотентность: SQL-функция `enqueue_medical_book_expiry_notifications`
 * (миграция 135) ведёт `staff_account_details.medical_book_expiry_notified_for`
 * и пропускает уже-уведомлённые ряды. Если HR обновил дату — флаг
 * автоматически расходится и юзер получит новое уведомление под новый
 * срок.
 *
 * Wiring: daily cron POST'ит на этот URL с `X-Cron-Secret`.
 *
 * Пример crontab-entry:
 *   0 6 * * * curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *     https://crm.sheerly.app/api/cron/medical-book-expiry-notifications \
 *     >> /var/log/medbook-notif.log 2>&1
 *
 * Auth: shared-secret из ENV — same pattern as auto-archive-notifications.
 */
export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }
  const provided = request.headers.get("x-cron-secret");
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  // RPC создан в миграции 135 — до регенерации `Database` типов кастуем
  // вызов, чтобы не блокировать CI. После следующего `supabase gen types`
  // каст уйдёт.
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
    ) => Promise<{ data: number | null; error: { message: string } | null }>
  )("enqueue_medical_book_expiry_notifications");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    enqueued: Number(data ?? 0),
    timestamp: new Date().toISOString(),
  });
}
