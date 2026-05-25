"use client";

import { BellRing, Share } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { usePushSubscription } from "@/hooks/use-push-subscription";

/**
 * Строка управления Web Push внутри колокольчика. Показывается, когда
 * заданы VAPID-ключи. Разрешение запрашивается по клику (без автопромпта).
 *
 * iOS-особенность: в Safari-вкладке Push API недоступен — он работает
 * только из установленного PWA. Поэтому на iOS вне standalone показываем
 * инструкцию «добавь на экран Домой» вместо переключателя.
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
      <div className="flex items-start gap-2.5 px-4 py-2.5 border-b border-border/40">
        <Share className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-xs leading-snug text-muted-foreground">
          Чтобы получать уведомления на iPhone, добавьте приложение на экран
          «Домой»:{" "}
          <span className="font-medium text-foreground">
            Поделиться → На экран «Домой»
          </span>
          , затем откройте его и включите push здесь.
        </p>
      </div>
    );
  }

  if (!supported) return null;

  const denied = permission === "denied" && !subscribed;

  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border/40">
      <BellRing className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium leading-tight text-foreground">
          Push-уведомления
        </div>
        <div className="text-[11px] leading-tight text-muted-foreground">
          {denied
            ? "Заблокированы в настройках браузера"
            : subscribed
              ? "Приходят при закрытом приложении"
              : "Получать при закрытом приложении"}
        </div>
      </div>
      <Switch
        checked={subscribed}
        disabled={busy || denied}
        onCheckedChange={(v) => (v ? enable() : disable())}
        aria-label="Push-уведомления"
      />
    </div>
  );
}
