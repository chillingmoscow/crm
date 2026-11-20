import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  createClient,
  getCachedActiveAccountId,
  getCachedUser,
} from "@/lib/supabase/server";
import { MEDIA_MAX_AGE_SECONDS, readMediaRequest } from "@/lib/storage/media";

/**
 * GET /api/media?b=<бакет>&p=<путь>[&w=&h=&r=][&a=1]&s=<подпись>
 *
 * Приватная картинка по постоянному адресу с кэшем браузера на месяц (см.
 * `lib/storage/media.ts`). Бинарный ответ с собственными заголовками в server
 * action не укладывается, поэтому это маршрут.
 */
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  const media = readMediaRequest(request.nextUrl.searchParams);
  if (!media) return new Response(null, { status: 404, headers: NO_STORE });

  const user = await getCachedUser();
  if (!user) return new Response(null, { status: 401, headers: NO_STORE });

  // Служебным ключом читаем только файлы аккаунта, в котором пользователь
  // сейчас работает (путь вложений начинается с id аккаунта): иначе выданный
  // однажды адрес открывался бы вошедшему пользователю любого другого
  // аккаунта. Режим `user` проверяют правила самого хранилища.
  if (media.access === "admin") {
    const accountId = await getCachedActiveAccountId();
    if (!accountId || !media.path.startsWith(`${accountId}/`)) {
      return new Response(null, { status: 404, headers: NO_STORE });
    }
  }

  const client = media.access === "admin" ? createAdminClient() : await createClient();
  const bucket = client.storage.from(media.bucket);

  // Уменьшенная копия делается сервисом картинок хранилища. Если он
  // недоступен (локально его часто нет) — отдаём оригинал: лучше тяжелее,
  // чем пусто.
  let file: Blob | null = null;
  if (media.transform) {
    const { data } = await bucket.download(media.path, { transform: media.transform });
    file = data;
  }
  if (!file) {
    const { data } = await bucket.download(media.path);
    file = data;
  }
  if (!file) return new Response(null, { status: 404, headers: NO_STORE });

  // Только картинки: иначе через наш домен можно было бы открыть загруженный
  // HTML. SVG дополнительно запираем политикой — скрипты в нём не выполнятся.
  const type = file.type || "application/octet-stream";
  if (!type.startsWith("image/")) return new Response(null, { status: 415, headers: NO_STORE });

  return new Response(file, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(file.size),
      // private — только кэш браузера, не общие прокси: фото не публичные.
      "Cache-Control": `private, max-age=${MEDIA_MAX_AGE_SECONDS}, immutable`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
