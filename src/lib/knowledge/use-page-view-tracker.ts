"use client";

import { useEffect, useRef } from "react";

import { recordKbPageView } from "@/lib/knowledge/analytics";

// ============================================================
// useKbPageViewTracker — heartbeat-based трекер времени на странице.
//
// Зачем: backend (миграция 077) ожидает one-shot session-записи через
// RPC kb_record_page_view. Клиент должен:
//   1. Знать, когда сессия началась.
//   2. Поддерживать «активность» — учитывать ТОЛЬКО время, когда юзер
//      реально на странице (вкладка visible) И что-то делает
//      (mouse / keyboard / scroll за последнюю минуту).
//   3. Сбрасывать сессию на сервер при visibilitychange='hidden',
//      pagehide, ИЛИ unmount компонента (route change).
//
// Без этого backend бы получал многочасовые сессии от юзеров, которые
// открыли вкладку и забыли — это фальшивит «топ-юзеров» дашборд.
//
// API: один хук, привязанный к pageId. Re-mount при смене pageId
// (key={pageId} в KbPageEditor уже это делает) → гарантирует чистый
// flush старой сессии и старт новой.
// ============================================================

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 сек — баланс между точностью и rate-limit'ом
const IDLE_TIMEOUT_MS = 60_000; // 60 сек без активности → idle
const MAX_SESSION_MS = 30 * 60_000; // 30 мин — серверный limit (sanity-check в RPC)
const MIN_SESSION_MS = 5_000; // < 5 сек — не пишем (RPC тоже отбросит)

const ACTIVITY_EVENTS = [
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
] as const;

interface UseKbPageViewTrackerArgs {
  pageId: string;
  /** Если false — трекер выключен. Используется чтобы не считать
   *  preview-режимы (version history) или не-залогиненные сессии. */
  enabled: boolean;
}

export function useKbPageViewTracker({
  pageId,
  enabled,
}: UseKbPageViewTrackerArgs) {
  // Refs, чтобы effect-cleanup видел актуальные значения без перезапуска
  // самого useEffect'а (pageId меняется → useEffect перезапускается;
  // sessionStart / lastActive обновляем in-place).
  const sessionStartRef = useRef<number>(Date.now());
  const lastActiveRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!enabled || !pageId) return;

    sessionStartRef.current = Date.now();
    lastActiveRef.current = Date.now();

    const onActivity = () => {
      const now = Date.now();
      // Если разрыв активности превысил idle-порог — считаем, что
      // tracker «спал» (юзер ушёл с вкладки или просто читал не
      // трогая мышь дольше минуты). Возобновление = новый старт
      // сессии. Без этого reset'а время БЕЗ activity между
      // idle-flush'ем (или последней активностью) и first-resume
      // засчитается в active-time следующей сессии — Codex #57 P1 #2.
      if (now - lastActiveRef.current > IDLE_TIMEOUT_MS) {
        sessionStartRef.current = now;
      }
      lastActiveRef.current = now;
    };

    /** Отправляет накопившуюся сессию на сервер и обнуляет окно. */
    const flush = () => {
      const start = sessionStartRef.current;
      const end = lastActiveRef.current;
      const elapsed = end - start;

      // Reset окно ДО POST'а — если flush сработал из-за visibility,
      // юзер может вернуться и мы не должны включать «холостое» время
      // в новую сессию.
      sessionStartRef.current = Date.now();
      lastActiveRef.current = Date.now();

      if (elapsed < MIN_SESSION_MS) return;

      void recordKbPageView({
        pageId,
        startedAt: new Date(start).toISOString(),
        endedAt: new Date(end).toISOString(),
      });
    };

    /** Heartbeat-tick: каждые 30с проверяем idle и max-len. */
    const tick = () => {
      const now = Date.now();
      const idleFor = now - lastActiveRef.current;
      const sessionLen = now - sessionStartRef.current;

      if (idleFor > IDLE_TIMEOUT_MS) {
        // Idle: flush и поставим окно в «паузу» (последующая активность
        // запустит новое).
        flush();
        return;
      }

      if (sessionLen > MAX_SESSION_MS) {
        // Многочасовая сессия → режем на 30-минутные чанки. Каждые
        // 30 мин активного использования = отдельная запись.
        flush();
      }
    };

    const interval = setInterval(tick, HEARTBEAT_INTERVAL_MS);

    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, onActivity, { passive: true }),
    );

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
      else {
        // Resume: возврат на вкладку — обновляем «маркеры», чтобы
        // время «вне фокуса» не учитывалось как activity.
        sessionStartRef.current = Date.now();
        lastActiveRef.current = Date.now();
      }
    };

    const onPageHide = () => flush();

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      clearInterval(interval);
      ACTIVITY_EVENTS.forEach((evt) =>
        window.removeEventListener(evt, onActivity),
      );
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      // Final flush на route-change / page-id-change.
      flush();
    };
  }, [pageId, enabled]);
}
