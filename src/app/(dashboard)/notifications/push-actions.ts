"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Подписка из браузера (PushSubscription.toJSON). */
export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Сохраняет/обновляет push-подписку текущего пользователя. Ключ —
 * endpoint (unique) — он физически принадлежит браузеру и переживает
 * logout/login. На общем устройстве (терминал заведения) второй
 * пользователь должен ПЕРЕХВАТИТЬ владение подпиской, иначе старый
 * владелец продолжит получать свои push на чужое устройство (privacy
 * leak). RLS update_own запрещает менять чужую строку, поэтому
 * conflict-путь идёт через admin-клиент, при этом user_id жёстко
 * берётся из проверенного getUser() — не из пользовательского ввода,
 * так что подменить владельца на произвольного нельзя.
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

  const admin = createAdminClient();
  const { error } = await admin.from("push_subscriptions").upsert(
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

/**
 * Удаляет подписку по endpoint (отписка устройства). Требует
 * аутентификации; endpoint — это подписка браузера, которым физически
 * пользуется вызывающий (приходит из pushManager.getSubscription, не
 * угадывается). Чистим через admin по endpoint, чтобы корректно снести
 * строку даже если на общем устройстве ею ещё владеет прежний юзер.
 */
export async function deletePushSubscription(
  endpoint: string,
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const admin = createAdminClient();
  const { error } = await admin
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint);

  if (error) {
    console.error("[push] deletePushSubscription failed:", error.message);
    return { ok: false };
  }
  return { ok: true };
}
