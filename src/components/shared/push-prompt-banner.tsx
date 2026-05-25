"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePushSubscription } from "@/hooks/use-push-subscription";

const DISMISS_KEY = "push-prompt-dismissed";

/**
 * Глобальный pre-prompt баннер под топбаром. Показывается один раз при
 * первом заходе, пока push не включён и пользователь не отклонил. Клик
 * «Включить» вызывает нативный запрос разрешения (мягкий pre-prompt —
 * люди реже блокируют его рефлекторно). На iOS-вкладке вместо кнопки —
 * подсказка про установку на экран «Домой». Управлять push потом можно
 * из ⚙ в колокольчике.
 */
export function PushPromptBanner() {
  const {
    supported,
    configured,
    permission,
    subscribed,
    busy,
    standalone,
    isIOS,
    enable,
  } = usePushSubscription();

  // По умолчанию скрыт (true) — чтобы SSR и первый клиентский рендер
  // совпадали (оба → null), без hydration-mismatch. Реальное значение
  // читаем из localStorage после монтирования.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  if (!configured || dismissed || subscribed || permission === "denied") {
    return null;
  }

  const iosNeedsInstall = isIOS && !standalone;
  // Не-iOS браузер без поддержки push — предлагать нечего.
  if (!iosNeedsInstall && !supported) return null;

  return (
    <div className="flex items-center gap-3 border-b border-brand/20 bg-brand/5 px-4 md:px-6 py-2">
      <BellRing className="size-4 shrink-0 text-brand" />
      {iosNeedsInstall ? (
        <p className="flex-1 text-[13px] leading-snug text-foreground">
          Чтобы получать уведомления на iPhone, добавьте приложение на экран
          «Домой»:{" "}
          <span className="font-medium">Поделиться → На экран «Домой»</span>.
        </p>
      ) : (
        <p className="flex-1 text-[13px] leading-snug text-foreground">
          <span className="font-medium">Включите уведомления</span> — не
          пропускайте назначения и упоминания, даже когда приложение закрыто.
        </p>
      )}
      <div className="flex items-center gap-1.5 shrink-0">
        {!iosNeedsInstall && (
          <Button size="sm" className="h-8" disabled={busy} onClick={() => enable()}>
            {busy ? "…" : "Включить"}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-muted-foreground"
          onClick={dismiss}
        >
          {iosNeedsInstall ? "Понятно" : "Не сейчас"}
        </Button>
      </div>
    </div>
  );
}
