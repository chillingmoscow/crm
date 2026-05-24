import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isPushConfigured } from "@/lib/push/vapid";
import {
  sendPushToSubscriptions,
  type PushPayload,
  type PushSubscriptionRow,
} from "@/lib/push/send";

/**
 * POST /api/cron/push-dispatch
 *
 * Рассылает Web Push по уведомлениям, ещё не доставленным наружу.
 * Источник вставок в notifications — только Postgres (триггеры + SQL из
 * cron'а), поэтому push нельзя подвесить в код создания: вместо этого
 * периодический cron добирает строки с pushed_at IS NULL.
 *
 * Идемпотентность: атомарный UPDATE ... SET pushed_at = now()
 * WHERE pushed_at IS NULL ... RETURNING — Postgres лочит строки, и
 * перекрытие cron-запусков не даёт двойной push (тот же приём, что
 * claim_birthday_* в миграции 140). Клейм ДО отправки → at-most-once:
 * упавшую отправку не ретраим (уведомление всё равно в колокольчике).
 *
 * Окно SEND_WINDOW_MS — защита от replay'я при долгом простое cron'а:
 * клеймим все неразосланные (чистим частичный индекс), но реально шлём
 * только свежие. Старьё гасим без push.
 *
 * Auth: shared-secret через X-Cron-Secret (как у остальных cron-роутов).
 * runtime nodejs — web-push использует node:crypto.
 */
export const runtime = "nodejs";

const SEND_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 часов

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

  if (!isPushConfigured()) {
    return NextResponse.json(
      { error: "VAPID keys not configured" },
      { status: 503 },
    );
  }

  try {
    return await runPushDispatch();
  } catch (e) {
    console.error("[push-dispatch] uncaught:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

async function runPushDispatch(): Promise<NextResponse> {
  const admin = createAdminClient();
  const nowMs = Date.now();

  // ── Атомарный клейм неразосланных уведомлений ────────────────────
  const { data: claimed, error: claimError } = await admin
    .from("notifications")
    .update({ pushed_at: new Date(nowMs).toISOString() })
    .is("pushed_at", null)
    .select("id, user_id, title, body, link, created_at");

  if (claimError) {
    console.error("[push-dispatch] claim failed:", claimError.message);
    return NextResponse.json({ error: claimError.message }, { status: 500 });
  }

  const claimedRows = claimed ?? [];
  // Шлём только свежие (старьё уже помечено pushed, но не доставляем).
  const toSend = claimedRows.filter(
    (n) => nowMs - new Date(n.created_at).getTime() <= SEND_WINDOW_MS,
  );

  if (toSend.length === 0) {
    return NextResponse.json({
      claimed: claimedRows.length,
      delivered: 0,
      timestamp: new Date(nowMs).toISOString(),
    });
  }

  // ── Загружаем подписки только нужных пользователей ───────────────
  const userIds = Array.from(new Set(toSend.map((n) => n.user_id)));
  const { data: subs, error: subsError } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);

  if (subsError) {
    console.error("[push-dispatch] load subscriptions failed:", subsError.message);
    return NextResponse.json({ error: subsError.message }, { status: 500 });
  }

  const subsByUser = new Map<string, PushSubscriptionRow[]>();
  for (const s of subs ?? []) {
    const list = subsByUser.get(s.user_id) ?? [];
    list.push({ id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth });
    subsByUser.set(s.user_id, list);
  }

  // ── Рассылка ─────────────────────────────────────────────────────
  let sent = 0;
  let pruned = 0;
  for (const n of toSend) {
    const targets = subsByUser.get(n.user_id);
    if (!targets || targets.length === 0) continue;
    const payload: PushPayload = {
      title: n.title,
      body: n.body,
      link: n.link,
      tag: n.id,
    };
    const res = await sendPushToSubscriptions(admin, targets, payload);
    sent += res.sent;
    pruned += res.pruned;
  }

  return NextResponse.json({
    claimed: claimedRows.length,
    eligible: toSend.length,
    delivered: sent,
    pruned,
    timestamp: new Date(nowMs).toISOString(),
  });
}
