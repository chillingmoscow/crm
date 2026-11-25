"use client";

import { useEffect, useState } from "react";

import { countCertificateAlerts } from "@/lib/finance/certificates-actions";

/** Событие окна: сертификаты контрагента изменились. */
export const CERTIFICATES_CHANGED_EVENT = "finance:certificates-changed";

/**
 * Сколько сертификатов и лицензий контрагентов истекают в ближайшие 30 дней
 * или уже просрочены — бейдж пункта «Контрагенты». Начальное значение — с
 * сервера (layout); дальше число перечитывается при возврате на вкладку и
 * после правки сертификата. Образец — `useInboxCount`.
 */
export function useCertificateAlertCount(enabled: boolean, initialCount: number): number {
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
        const next = await countCertificateAlerts();
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
    window.addEventListener(CERTIFICATES_CHANGED_EVENT, schedule);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", schedule);
      window.removeEventListener(CERTIFICATES_CHANGED_EVENT, schedule);
    };
  }, [enabled, initialCount]);

  return enabled ? count : 0;
}
