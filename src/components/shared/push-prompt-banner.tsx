"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePushSubscription } from "@/hooks/use-push-subscription";
import { PUSH_PROMPT_COOKIE, type PushPromptState } from "@/lib/ui/push-prompt-pref";

const DISMISS_KEY = "push-prompt-dismissed";

/**
 * Глобальный pre-prompt баннер под топбаром. Показывается один раз при
 * первом заходе, пока push не включён и пользователь не отклонил. Клик
 * «Включить» вызывает нативный запрос разрешения (мягкий pre-prompt —
 * люди реже блокируют его рефлекторно). На iOS-вкладке вместо кнопки —
 * подсказка про установку на экран «Домой». Управлять push потом можно
 * из ⚙ в колокольчике.
 */
export function PushPromptBanner({
  initial,
}: {
  /** Решение из cookie: «show», «ios» (подсказка про экран «Домой») или нет. */
  initial?: PushPromptState;
}) {
  const {
    supported,
    configured,
    permission,
    subscribed,
    busy,
    standalone,
    isIOS,
    ready,
    enable,
  } = usePushSubscription();

  // Отклонён ли баннер — localStorage, прочитанный после монтирования. До
  // чтения (и на сервере) решение берём из cookie (`initial`): её пишет
  // браузер, поэтому страница сразу рисуется с баннером или без него, и он
  // не выезжает сверху, сдвигая всё вниз.
  const [dismissed, setDismissed] = useState<boolean | null>(null);

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

  const known = ready && dismissed !== null;
  const iosNeedsInstall = known ? isIOS && !standalone : initial === "ios";
  // На iOS-вкладке Notification.permission неинформативен (Push API нет) —
  // показываем install-подсказку, гейтим только dismissed/subscribed.
  // Для остальных — только настоящий первый заход (permission "default"):
  // после grant/deny (в т.ч. если потом выключили push в ⚙ — там остаётся
  // "granted") баннер больше не навязывается; управлять можно из ⚙.
  const wanted =
    configured &&
    !dismissed &&
    !subscribed &&
    (iosNeedsInstall || (supported && permission === "default"));
  const visible = known ? wanted : configured && (initial === "show" || initial === "ios");
  const state: PushPromptState = wanted ? (iosNeedsInstall ? "ios" : "show") : "hide";

  useEffect(() => {
    if (!known) return;
    document.cookie = `${PUSH_PROMPT_COOKIE}=${state}; path=/; max-age=31536000; samesite=lax`;
  }, [known, state]);

  if (!visible) return null;

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
