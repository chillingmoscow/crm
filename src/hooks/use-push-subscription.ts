"use client";

import { useCallback, useEffect, useState } from "react";

import {
  deletePushSubscription,
  savePushSubscription,
} from "@/app/(dashboard)/notifications/push-actions";

/** VAPID public key — тот же, что серверный VAPID_PUBLIC_KEY. */
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

/** base64url → Uint8Array для applicationServerKey. Явный ArrayBuffer-
 *  бэкинг, чтобы тип удовлетворял BufferSource (а не SharedArrayBuffer). */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

type SubKeys = { p256dh: string; auth: string };

function extractKeys(sub: PushSubscription): SubKeys | null {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) return null;
  return { p256dh, auth };
}

/**
 * Ждёт активации SW на КОНКРЕТНОЙ регистрации, не зависая. В отличие от
 * `navigator.serviceWorker.ready` (который в некоторых браузерах/состояниях
 * не резолвится — из-за этого кнопка «Включить» висла на Windows), здесь
 * опрашиваем live-геттер `reg.active` с таймаутом. На таймауте бросаем —
 * enable() ловит, разблокирует кнопку и логирует.
 */
async function waitForActiveWorker(
  reg: ServiceWorkerRegistration,
  timeoutMs = 10000,
): Promise<void> {
  const start = Date.now();
  while (!reg.active) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("service worker did not activate in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export interface UsePushSubscription {
  /** Браузер поддерживает Web Push (SW + PushManager + Notification). */
  supported: boolean;
  /** Сконфигурированы ли VAPID-ключи на клиенте. */
  configured: boolean;
  /** Текущее разрешение на уведомления. */
  permission: NotificationPermission | "unsupported";
  /** Устройство сейчас подписано. */
  subscribed: boolean;
  /** Идёт subscribe/unsubscribe. */
  busy: boolean;
  /** PWA установлено (display-mode standalone) — важно для iOS. */
  standalone: boolean;
  /** iOS/iPadOS — там push работает ТОЛЬКО из установленного PWA. */
  isIOS: boolean;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

/**
 * Управляет Web Push подпиской текущего устройства: регистрирует SW,
 * запрашивает разрешение, подписывается и синхронизирует подписку с
 * сервером. Разрешение запрашивается только по явному действию
 * пользователя (кнопка), без автопромпта на загрузке.
 */
export function usePushSubscription(): UsePushSubscription {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  const configured = Boolean(VAPID_PUBLIC_KEY);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Платформа и режим установки считаются ВСЕГДА, не завися от
    // push-поддержки: на iOS Safari (вкладке) Push API отсутствует, но
    // нам нужно показать подсказку «установи PWA».
    const ua = navigator.userAgent;
    const iOS =
      /iPad|iPhone|iPod/.test(ua) ||
      // iPadOS 13+ маскируется под Mac — ловим по touch.
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIsIOS(iOS);
    setStandalone(
      window.matchMedia?.("(display-mode: standalone)").matches ||
        // iOS Safari standalone флаг.
        (window.navigator as unknown as { standalone?: boolean }).standalone ===
          true,
    );

    const isSupported =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(isSupported);
    if (!isSupported) return;

    setPermission(Notification.permission);

    // Уже подписаны? (SW мог остаться с прошлой сессии.) getRegistration()
    // резолвится сразу (в т.ч. в undefined), в отличие от .ready, который
    // висит вечно, если SW ни разу не регистрировали.
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setSubscribed(Boolean(sub)))
      .catch(() => {});
  }, []);

  const enable = useCallback(async () => {
    if (!supported || !VAPID_PUBLIC_KEY || busy) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") return;

      const reg = await navigator.serviceWorker.register("/sw.js");
      // НЕ navigator.serviceWorker.ready — он может не зарезолвиться и
      // подвесить кнопку. Ждём активации именно нашей регистрации с
      // таймаутом. pushManager.subscribe требует активного воркера.
      await waitForActiveWorker(reg);

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      const keys = extractKeys(sub);
      if (!keys) return;
      const res = await savePushSubscription(
        { endpoint: sub.endpoint, ...keys },
        navigator.userAgent,
      );
      setSubscribed(res.ok);
    } catch (e) {
      console.error("[push] enable failed:", e);
    } finally {
      setBusy(false);
    }
  }, [supported, busy]);

  const disable = useCallback(async () => {
    if (!supported || busy) return;
    setBusy(true);
    try {
      // getRegistration() (не .ready) — чтобы не зависнуть, если активного
      // SW нет.
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await deletePushSubscription(endpoint);
      }
      setSubscribed(false);
    } catch (e) {
      console.error("[push] disable failed:", e);
    } finally {
      setBusy(false);
    }
  }, [supported, busy]);

  return {
    supported,
    configured,
    permission,
    subscribed,
    busy,
    standalone,
    isIOS,
    enable,
    disable,
  };
}
