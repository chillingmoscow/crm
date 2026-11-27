"use client";

import { useEffect, useState } from "react";

/**
 * Счётчик для бейджа меню: начальное число приходит с сервера (layout),
 * дальше перечитывается при возврате на вкладку и по событию окна `event`
 * (если экран сообщает об изменении). Образец — `useInboxCount`.
 */
export function useRefreshingCount(
  load: () => Promise<number>,
  enabled: boolean,
  initialCount: number,
  event?: string,
): number {
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
        const next = await load();
        if (!cancelled && request === current) setCount(next);
      } catch {
        /* Без связи оставляем последнее известное число. */
      }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 150);
    };
    window.addEventListener("focus", schedule);
    if (event) window.addEventListener(event, schedule);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", schedule);
      if (event) window.removeEventListener(event, schedule);
    };
  }, [load, enabled, initialCount, event]);

  return enabled ? count : 0;
}
