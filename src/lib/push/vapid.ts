import webpush from "web-push";

/**
 * VAPID-инициализация web-push. Ключи — только серверные:
 *   VAPID_PUBLIC_KEY  — публичный (тот же, что NEXT_PUBLIC_VAPID_PUBLIC_KEY,
 *                       клиент использует его для pushManager.subscribe)
 *   VAPID_PRIVATE_KEY — приватный, никогда не уходит на клиент
 *   VAPID_SUBJECT     — mailto:/URL контакта (требование Web Push spec)
 *
 * Генерация: `npx web-push generate-vapid-keys`.
 */
let configured = false;

export function isPushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
  );
}

/**
 * Лениво конфигурирует web-push один раз за процесс. Возвращает false,
 * если ключи не заданы (push-доставка тогда тихо отключена).
 */
export function ensureWebPush(): typeof webpush | null {
  if (!isPushConfigured()) return null;
  if (!configured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:noreply@sheerly.app",
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    configured = true;
  }
  return webpush;
}
