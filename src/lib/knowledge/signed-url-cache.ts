/**
 * Двух-уровневый кэш signed URL'ов для KB-attachments.
 *
 * Зачем: BlockNote дёргает `resolveFileUrl` на каждый рендер блока
 * (в т.ч. при resize image). Без кэша свежий signed URL минтился бы
 * каждый раз → `<img src>` меняется → браузер заново фетчит файл →
 * изображение мигает на 1-2 секунды и страница «прыгает».
 *
 * Кэш:
 *   1. Memory `Map` — горячий, в пределах текущего mount'а.
 *   2. `localStorage` — выживает page-reload. Без него reload минтит
 *      свежий URL → src меняется → cache-miss → re-fetch → flash.
 *
 * Server signs с TTL 1ч (`DEFAULT_TTL_SECONDS` в attachments.ts);
 * кэшируем на 50 минут — запас до expiry.
 */

const SIGNED_URL_TTL_MS = 50 * 60 * 1000;
const SIGNED_URL_LS_PREFIX = "kb-signed-url:";
const memoryCache = new Map<string, { url: string; expiresAt: number }>();

export function getCachedSignedUrl(storagePath: string): string | null {
  const entry = memoryCache.get(storagePath);
  if (entry && entry.expiresAt > Date.now()) return entry.url;
  if (entry) memoryCache.delete(storagePath);

  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SIGNED_URL_LS_PREFIX + storagePath);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { url?: string; expiresAt?: number };
    if (
      typeof parsed.url !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt < Date.now()
    ) {
      window.localStorage.removeItem(SIGNED_URL_LS_PREFIX + storagePath);
      return null;
    }
    memoryCache.set(storagePath, {
      url: parsed.url,
      expiresAt: parsed.expiresAt,
    });
    return parsed.url;
  } catch {
    return null;
  }
}

export function setCachedSignedUrl(storagePath: string, url: string): void {
  const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
  memoryCache.set(storagePath, { url, expiresAt });
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SIGNED_URL_LS_PREFIX + storagePath,
      JSON.stringify({ url, expiresAt }),
    );
  } catch {
    // QuotaExceeded / private mode — tolerable, memory cache remains.
  }
}
