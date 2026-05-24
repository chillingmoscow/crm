"use server";

import { createClient } from "@/lib/supabase/server";

/** Подписка из браузера (PushSubscription.toJSON). */
export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Сохраняет/обновляет push-подписку текущего пользователя. Ключ —
 * endpoint (unique). Повторная подписка того же устройства обновляет
 * ключи и last_seen_at. RLS пускает запись только для своих строк
 * (user_id = auth.uid()).
 */
export async function savePushSubscription(
  sub: PushSubscriptionInput,
  userAgent?: string,
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      user_agent: userAgent ?? null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    console.error("[push] savePushSubscription failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}

/** Удаляет подписку по endpoint (отписка). RLS ограничивает своими. */
export async function deletePushSubscription(
  endpoint: string,
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint);

  if (error) {
    console.error("[push] deletePushSubscription failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}
