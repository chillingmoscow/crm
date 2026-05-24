"use client";

import { BellOff, BellRing, Share } from "lucide-react";

import { usePushSubscription } from "@/hooks/use-push-subscription";

/**
 * Строка управления Web Push внутри колокольчика. Показывается, когда
 * заданы VAPID-ключи. Разрешение запрашивается по клику (без автопромпта).
 *
 * iOS-особенность: в Safari-вкладке Push API недоступен — он работает
 * только из установленного PWA. Поэтому на iOS вне standalone показываем
 * инструкцию «добавь на экран Домой» вместо кнопки «Включить».
 */
export function PushToggle() {
  const {
    supported,
    configured,
    permission,
    subscribed,
    busy,
    standalone,
    isIOS,
    enable,
    disable,
  } = usePushSubscription();

  if (!configured) return null;

  // iOS вне установленного PWA: push в Safari не заработает — нужна
  // установка на экран «Домой».
  if (isIOS && !standalone) {
    return (
      <div className="flex items-start gap-2 px-4 py-2 text-[11px] text-muted-foreground border-b border-border/40">
        <Share className="size-3.5 shrink-0 mt-0.5" />
        <span>
          Чтобы получать уведомления на iPhone, добавьте приложение на экран
          «Домой»: <span className="text-foreground font-medium">Поделиться → На
          экран «Домой»</span>, затем откройте его и включите push здесь.
        </span>
      </div>
    );
  }

  if (!supported) return null;

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
