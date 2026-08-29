import "server-only";

import { isRewriteEnabled, normalizeBase, rewriteToInternal } from "./internal-url-rewrite";

/**
 * Серверные вызовы Supabase ходят в соседний контейнер, а не через публичный
 * домен.
 *
 * Приложение и Supabase живут на одном хосте, но серверные клиенты били в
 * `NEXT_PUBLIC_SUPABASE_URL`, то есть каждый вызов из RSC уходил наружу и
 * возвращался: DNS → TLS → nginx → Kong. Замер на проде: **~60 мс против
 * ~2-3 мс** по внутренней docker-сети. Страница делает 18-35 обращений в
 * 10-13 последовательных волнах, так что одна только эта дорога съедала
 * 600-800 мс на каждую загрузку — во всех разделах приложения.
 *
 * Почему переписываем запрос, а не адрес клиента. Storage собирает ссылку на
 * файл из базового адреса клиента:
 *
 *     signedUrl = encodeURI(`${this.url}${datum.signedURL}`)
 *
 * (`@supabase/storage-js`, `StorageFileApi.createSignedUrls`). Тот же приём в
 * `getPublicUrl`. Переключи клиент на внутренний адрес — и в браузер уедут
 * ссылки вида `http://supabase-kong-…:8000/storage/…`, которые снаружи не
 * открываются: пропадут картинки позиций в форме акта, аватары, вложения базы
 * знаний.
 *
 * Поэтому клиент остаётся на публичном URL (ссылки корректны), а подменяется
 * только адрес фактического HTTP-запроса. Ни одна вызывающая сторона об этом
 * не знает и знать не должна.
 *
 * Без `SUPABASE_INTERNAL_URL` возвращаем undefined и работаем как раньше —
 * локальная разработка и превью-окружения ничего не замечают.
 */

const PUBLIC_URL = normalizeBase(process.env.NEXT_PUBLIC_SUPABASE_URL);
const INTERNAL_URL = normalizeBase(process.env.SUPABASE_INTERNAL_URL);
const enabled = isRewriteEnabled(PUBLIC_URL, INTERNAL_URL);

const toInternal = (url: string) => rewriteToInternal(url, PUBLIC_URL, INTERNAL_URL);

/**
 * `fetch` для серверных клиентов Supabase. undefined — значит подмена не
 * настроена, и клиент нужно создавать без переопределения.
 */
export function internalFetch(): typeof fetch | undefined {
  if (!enabled) return undefined;

  return (input: RequestInfo | URL, init?: RequestInit) => {
    // Обычный путь: supabase-js и postgrest-js зовут fetch со строкой.
    if (typeof input === "string") return fetch(toInternal(input), init);
    if (input instanceof URL) return fetch(toInternal(input.toString()), init);

    // Request приходит редко; пересобираем, сохраняя метод, заголовки и тело.
    const rewritten = toInternal(input.url);
    return rewritten === input.url ? fetch(input, init) : fetch(new Request(rewritten, input), init);
  };
}

/**
 * Блок `global` для конструктора клиента. Пустой объект, когда подмена
 * выключена: `{ fetch: undefined }` supabase-js трактует иначе, чем отсутствие
 * ключа, поэтому ключ не добавляем вовсе.
 */
export function internalGlobalOptions(): { fetch: typeof fetch } | Record<string, never> {
  const fetchImpl = internalFetch();
  return fetchImpl ? { fetch: fetchImpl } : {};
}
