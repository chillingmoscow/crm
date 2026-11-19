"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Фоновое обновление экрана «Зарплаты» по правилу DS → «Состояния»: только на
 * видимой вкладке, а при ошибке экран помнит время последних удачных данных,
 * чтобы показать отметку «не удалось обновить», а не выдавать старые суммы
 * за свежие.
 */
export function useAutoRefresh(reload: () => Promise<unknown>, intervalMs: number) {
  const [updatedAt, setUpdatedAt] = useState(() => new Date());
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const refresh = useCallback(async () => {
    try {
      await reload();
      setUpdatedAt(new Date());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [reload]);
  useEffect(() => {
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      void refresh().finally(() => {
        inFlight = false;
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);
  const retry = useCallback(async () => {
    setRetrying(true);
    await refresh();
    setRetrying(false);
  }, [refresh]);
  return { failed, updatedAt, retry, retrying };
}

export function RefreshFailedNotice({
  updatedAt,
  retry,
  retrying,
  className,
}: {
  updatedAt: Date;
  retry: () => void;
  retrying: boolean;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm ${className ?? ""}`}
    >
      <span>
        Не удалось обновить данные. Суммы показаны на{" "}
        {updatedAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}.
      </span>
      <Button variant="outline" size="sm" disabled={retrying} onClick={retry}>
        Повторить
      </Button>
    </div>
  );
}
