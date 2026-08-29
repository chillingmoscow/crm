/**
 * Чистая часть подмены адреса Supabase на серверной стороне.
 *
 * Вынесена отдельно от `internal-url.ts`, потому что тот помечен
 * `server-only` и читает окружение на импорте — тест-раннер такой модуль
 * не загрузит. Здесь только правило подмены, без окружения и без импортов
 * из `@/...` (node:test не резолвит alias из tsconfig).
 */

/** Убирает хвостовые слэши, чтобы склейка адресов не давала двойной слэш. */
export function normalizeBase(url: string | undefined | null): string {
  return (url ?? "").replace(/\/+$/, "");
}

/**
 * Включать ли подмену. Оба адреса должны быть заданы и различаться — иначе
 * это лишняя обёртка над fetch без всякого эффекта.
 */
export function isRewriteEnabled(publicUrl: string, internalUrl: string): boolean {
  return Boolean(publicUrl && internalUrl && publicUrl !== internalUrl);
}

/**
 * Меняет публичный префикс на внутренний. Чужие адреса возвращает как есть:
 * через тот же fetch ходят и запросы, не относящиеся к Supabase.
 *
 * Сверяем по префиксу с последующей границей пути, чтобы `…/supabase` не
 * подменялся в адресе вида `…/supabase-docs`.
 */
export function rewriteToInternal(url: string, publicUrl: string, internalUrl: string): string {
  if (!isRewriteEnabled(publicUrl, internalUrl)) return url;
  if (url === publicUrl) return internalUrl;
  if (!url.startsWith(publicUrl)) return url;

  const rest = url.slice(publicUrl.length);
  const boundary = rest[0];
  if (boundary !== "/" && boundary !== "?" && boundary !== "#") return url;
  return internalUrl + rest;
}
