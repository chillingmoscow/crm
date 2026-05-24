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

  const configured = Boolean(VAPID_PUBLIC_KEY);

  useEffect(() => {
    const isSupported =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(isSupported);
    if (!isSupported) return;

    setPermission(Notification.permission);
    setStandalone(
      window.matchMedia?.("(display-mode: standalone)").matches ||
        // iOS Safari standalone флаг.
        (window.navigator as unknown as { standalone?: boolean }).standalone ===
          true,
    );

    // Уже подписаны? (SW мог остаться с прошлой сессии.)
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
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
      await navigator.serviceWorker.ready;

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
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
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
    enable,
    disable,
  };
}
