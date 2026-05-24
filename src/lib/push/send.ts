import type { SupabaseClient } from "@supabase/supabase-js";

import { ensureWebPush } from "@/lib/push/vapid";

/** Строка push_subscriptions, нужная для отправки. */
export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Полезная нагрузка, которую SW распакует в showNotification. */
export interface PushPayload {
  title: string;
  body?: string | null;
  link?: string | null;
  icon?: string | null;
  tag?: string | null;
}

export interface SendResult {
  sent: number;
  failed: number;
  pruned: number;
}

/**
 * Рассылает один payload по списку подписок. Мёртвые подписки
 * (HTTP 404/410 от push-сервиса — отписка/протухший endpoint) удаляются
 * из push_subscriptions через переданный admin-клиент (service-role,
 * обходит RLS). Остальные ошибки логируются, но не роняют рассылку.
 */
export async function sendPushToSubscriptions(
  admin: SupabaseClient,
  subscriptions: PushSubscriptionRow[],
  payload: PushPayload,
): Promise<SendResult> {
  const webpush = ensureWebPush();
  if (!webpush || subscriptions.length === 0) {
    return { sent: 0, failed: 0, pruned: 0 };
  }

  const body = JSON.stringify(payload);
  const deadIds: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        );
        sent += 1;
      } catch (e) {
        const statusCode = (e as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          deadIds.push(sub.id);
        } else {
          failed += 1;
          console.error("[push] send failed:", statusCode ?? e);
        }
      }
    }),
  );

  let pruned = 0;
  if (deadIds.length > 0) {
    const { error } = await admin
      .from("push_subscriptions")
      .delete()
      .in("id", deadIds);
    if (error) {
      console.error("[push] prune dead subscriptions failed:", error.message);
    } else {
      pruned = deadIds.length;
    }
  }

  return { sent, failed, pruned };
}
