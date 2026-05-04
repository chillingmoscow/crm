import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/cron/auto-archive-notifications
 *
 * Cron-triggered endpoint, защищённый shared-secret'ом из ENV
 * (`CRON_SECRET`). Вызывает Postgres-функцию
 * `public.auto_archive_old_notifications()` (миграция 099) которая
 * UPDATE'ит `archived_at` на read'ах старше 30 дней.
 *
 * Wiring: на проде поднять daily cron, который POST'ит на этот URL
 * с заголовком `X-Cron-Secret: ${CRON_SECRET}`. Coolify scheduled
 * task'ом или системным crontab'ом — оба работают.
 *
 * Пример crontab-entry (системный, на VPS):
 *   0 4 * * * curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
 *     https://crm.sheerly.app/api/cron/auto-archive-notifications \
 *     >> /var/log/notif-archive.log 2>&1
 *
 * Возвращает count архивированных rows для observability.
 *
 * Auth: shared-secret вместо session-cookie — cron-вызовы идут без
 * залогиненного юзера. Используем service-role client напрямую (а не
 * SSR-клиент, который зависит от cookies) → RPC вызывается с
 * privileged context'ом, фильтр через WHERE-clause функции (read =
 * true AND old).
 */
export async function POST(request: Request) {
  // Auth via shared secret. Без CRON_SECRET в env — endpoint
  // возвращает 503: явный fail-fast чем silent-no-op, чтобы misconfig
  // на проде сразу был виден в alert'ах.
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

  // Service-role client — RLS обходим, но SQL-функция сама
  // фильтрует rows (read=true AND created_at < now()-30d).
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc(
    "auto_archive_old_notifications",
  );
  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    archived: Number(data ?? 0),
    timestamp: new Date().toISOString(),
  });
}
