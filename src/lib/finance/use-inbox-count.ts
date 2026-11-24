"use client";

import { useEffect, useState } from "react";

import { countInbox } from "@/lib/finance/recurring";

/** Событие окна: очередь «На разбор» изменилась (платёж разобран или появились новые). */
export const INBOX_CHANGED_EVENT = "finance:inbox-changed";

/** Сообщить счётчикам, что очередь «На разбор» изменилась. */
export function notifyInboxChanged() {
  window.dispatchEvent(new Event(INBOX_CHANGED_EVENT));
}

/**
 * Сколько ожидаемых платежей ждут разбора — бейдж пункта «На разбор» в
 * сайдбаре (вместе с официальной частью зарплаты на разборе). Начальное
 * значение приходит с сервера (layout); дальше число
 * перечитывается при возврате на вкладку и по событию
 * `finance:inbox-changed`, которое шлёт очередь после каждого разбора.
 * Образец — `useNewCandidateCount`, только без realtime: сроки наступают раз
 * в сутки, а разбирают их здесь же, в приложении.
 */
export function useInboxCount(enabled: boolean, initialCount: number): number {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    setCount(enabled ? initialCount : 0);
    if (!enabled) return;
    let cancelled = false;
    let request = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = async () => {
      const current = ++request;
      try {
        const next = await countInbox();
        if (!cancelled && request === current) setCount(next);
      } catch {
        /* Без связи оставляем последнее известное число. */
      }
    };
    // Несколько разборов подряд — один запрос.
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 150);
    };

    window.addEventListener("focus", schedule);
    window.addEventListener(INBOX_CHANGED_EVENT, schedule);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", schedule);
      window.removeEventListener(INBOX_CHANGED_EVENT, schedule);
    };
  }, [enabled, initialCount]);

  return enabled ? count : 0;
}
