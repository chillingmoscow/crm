import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isPushConfigured } from "@/lib/push/vapid";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
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
// Максимум строк за один прогон — чтобы после простоя cron'а не забрать
// тысячи разом (claim-before-send → таймаут = недоставка хвоста). Cron
// раз в минуту дренит остаток следующими прогонами (oldest-first).
const BATCH_SIZE = 500;
// Параллелизм отправки по уведомлениям (sendPushToSubscriptions внутри
// сам шлёт всем подпискам пользователя). Воркер не бросает — ошибки
// глотаются внутри, поэтому runWithConcurrency не прервётся.
const SEND_CONCURRENCY = 8;

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

  // ── Шаг 1: кандидаты (newest-first, ограничены батчем) ───────────
  // PostgREST не умеет LIMIT на UPDATE, поэтому сначала выбираем id.
  // Newest-first критично: при бэклоге > BATCH_SIZE после простоя cron'а
  // oldest-first забирал бы только старьё (за окном отправки) и свежие
  // уведомления голодали бы, пока не сольётся весь старый хвост. Берём
  // свежие в приоритете; старое (всё равно подавляется окном) дренится
  // следующими прогонами.
  const { data: candidates, error: selError } = await admin
    .from("notifications")
    .select("id")
    .is("pushed_at", null)
    .order("created_at", { ascending: false })
    .limit(BATCH_SIZE);

  if (selError) {
    console.error("[push-dispatch] select candidates failed:", selError.message);
    return NextResponse.json({ error: selError.message }, { status: 500 });
  }
  const candidateIds = (candidates ?? []).map((c) => c.id);
  if (candidateIds.length === 0) {
    return NextResponse.json({
      claimed: 0,
      delivered: 0,
      timestamp: new Date(nowMs).toISOString(),
    });
  }

  // ── Шаг 2: атомарный клейм именно этих id ────────────────────────
  // `pushed_at is null` в WHERE + блокировка строк гарантируют, что при
  // перекрытии прогонов каждую строку заберёт только один (второй
  // обновит 0 из них и вернёт меньше) — двойного push нет.
  const { data: claimed, error: claimError } = await admin
    .from("notifications")
    .update({ pushed_at: new Date(nowMs).toISOString() })
    .in("id", candidateIds)
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

  // ── Рассылка (bounded concurrency) ───────────────────────────────
  let sent = 0;
  let pruned = 0;
  await runWithConcurrency(toSend, SEND_CONCURRENCY, async (n) => {
    const targets = subsByUser.get(n.user_id);
    if (!targets || targets.length === 0) return;
    const payload: PushPayload = {
      title: n.title,
      body: n.body,
      link: n.link,
      tag: n.id,
    };
    const res = await sendPushToSubscriptions(admin, targets, payload);
    // Мутация общих счётчиков безопасна: JS однопоточный, гонок нет.
    sent += res.sent;
    pruned += res.pruned;
  });

  return NextResponse.json({
    claimed: claimedRows.length,
    eligible: toSend.length,
    // Заклеймлены, но старше окна → намеренно не доставлены (видимость
    // для диагностики слишком редкого cron'а).
    stale: claimedRows.length - toSend.length,
    delivered: sent,
    pruned,
    timestamp: new Date(nowMs).toISOString(),
  });
}
