"use client";

import { BellOff, BellRing } from "lucide-react";

import { usePushSubscription } from "@/hooks/use-push-subscription";

/**
 * Строка управления Web Push внутри колокольчика. Показывается только
 * когда браузер поддерживает push и заданы VAPID-ключи. Разрешение
 * запрашивается по клику (без автопромпта).
 */
export function PushToggle() {
  const { supported, configured, permission, subscribed, busy, enable, disable } =
    usePushSubscription();

  if (!supported || !configured) return null;

  // Разрешение заблокировано в браузере — подписаться нельзя.
  if (permission === "denied" && !subscribed) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-[11px] text-muted-foreground border-b border-border/40">
        <BellOff className="size-3.5 shrink-0" />
        <span>Push заблокированы в настройках браузера</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border/40">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <BellRing className="size-3.5 shrink-0" />
        <span>
          {subscribed
            ? "Push-уведомления включены"
            : "Получать уведомления при закрытом приложении"}
        </span>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => (subscribed ? disable() : enable())}
        className="text-[11px] font-medium text-foreground hover:underline disabled:opacity-50 shrink-0"
      >
        {busy ? "…" : subscribed ? "Отключить" : "Включить"}
      </button>
    </div>
  );
}
