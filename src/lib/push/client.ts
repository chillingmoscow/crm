"use client";

import { deletePushSubscription } from "@/app/(dashboard)/notifications/push-actions";

/**
 * Отписывает текущий браузер от Web Push и удаляет его строку из БД.
 * Вызывать ПЕРЕД signOut: подписка живёт per-browser и переживает смену
 * сессии, поэтому на общем устройстве (терминал заведения) без отписки
 * следующий пользователь продолжил бы получать push прежнего владельца
 * (privacy leak). Удаление идёт через server action, который требует
 * активной сессии, — отсюда «перед signOut».
 *
 * Best-effort: любые ошибки логируются, но не блокируют выход.
 */
export async function unsubscribePushForSignOut(): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await deletePushSubscription(endpoint);
  } catch (e) {
    console.error("[push] unsubscribe on sign-out failed:", e);
  }
}
