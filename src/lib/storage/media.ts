import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Постоянный адрес приватной картинки: `/api/media?…&s=<подпись>`.
 *
 * Зачем. Подписанная ссылка Supabase содержит время выдачи, и на каждый заход
 * на страницу адрес новый — браузер заново качает те же фото. Сам Supabase
 * при этом не присылает `Cache-Control`, так что даже одинаковый адрес
 * кэшируется наугад. Здесь адрес зависит только от файла и размера копии, а
 * маршрут `/api/media` отдаёт `private, max-age=30 дней, immutable` — фото
 * берутся из кэша браузера месяц.
 *
 * Доступ. Адрес выдаёт только сервер и только после своей проверки прав (как
 * раньше подпись). Подпись — HMAC на серверном ключе: подобрать или изменить
 * путь нельзя. Открыть адрес может только вошедший пользователь, а для
 * `access: "user"` файл ещё и читается от его имени — с теми же правилами
 * доступа хранилища, что и прежняя подписанная ссылка.
 *
 * Файлы неизменяемые: новое фото — новый путь (у всех загрузок путь со
 * случайной частью, `upsert: false`). Поэтому адресу можно жить вечно.
 */

/** Сколько браузер держит картинку: месяц. */
export const MEDIA_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Бакеты, картинки из которых можно отдавать этим маршрутом. */
export const MEDIA_BUCKETS = [
  "account-attachments",
  "candidate-files",
  "crm-guest-photos",
  "payroll-photos",
  "task-evidence",
  "schedule-evidence",
] as const;
export type MediaBucket = (typeof MEDIA_BUCKETS)[number];

export type MediaTransform = {
  width?: number;
  height?: number;
  resize?: "cover" | "contain";
};

/**
 * `admin` — файл читается служебным ключом: права уже проверил код, выдавший
 * адрес (каталог и акты читают свои таблицы админом). `user` — от имени
 * вошедшего пользователя, правилами доступа хранилища.
 */
export type MediaAccess = "admin" | "user";

export type MediaRequest = {
  bucket: MediaBucket;
  path: string;
  transform: MediaTransform | null;
  access: MediaAccess;
};

function key(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY не задан");
  // Отдельный ключ под эту задачу: подпись адреса картинки не годится ни для
  // чего другого, даже если когда-нибудь утечёт.
  return createHmac("sha256", secret).update("sheerly:media:v1").digest();
}

function canonical(request: MediaRequest): string {
  const t = request.transform;
  return [
    request.bucket,
    request.path,
    request.access,
    t?.width ?? "",
    t?.height ?? "",
    t?.resize ?? "",
  ].join("\n");
}

function sign(request: MediaRequest): string {
  return createHmac("sha256", key()).update(canonical(request)).digest("base64url").slice(0, 32);
}

const isBucket = (value: string | null): value is MediaBucket =>
  value !== null && (MEDIA_BUCKETS as readonly string[]).includes(value);

const dimension = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 4000 ? n : undefined;
};

/** Постоянный адрес картинки для `<img src>`. */
export function mediaUrl(
  bucket: MediaBucket,
  path: string,
  options: { transform?: MediaTransform; access?: MediaAccess } = {},
): string {
  const request: MediaRequest = {
    bucket,
    path,
    transform: options.transform ?? null,
    access: options.access ?? "user",
  };
  const params = new URLSearchParams({ b: bucket, p: path });
  if (request.access === "admin") params.set("a", "1");
  if (request.transform?.width) params.set("w", String(request.transform.width));
  if (request.transform?.height) params.set("h", String(request.transform.height));
  if (request.transform?.resize) params.set("r", request.transform.resize);
  params.set("s", sign(request));
  return `/api/media?${params.toString()}`;
}

/** Разбор и проверка адреса; null — подпись не сошлась или параметры чужие. */
export function readMediaRequest(params: URLSearchParams): MediaRequest | null {
  const bucket = params.get("b");
  const path = params.get("p");
  const signature = params.get("s");
  if (!isBucket(bucket) || !path || !signature) return null;
  if (path.includes("..") || path.startsWith("/")) return null;
  const resize = params.get("r");
  if (resize !== null && resize !== "cover" && resize !== "contain") return null;
  const width = dimension(params.get("w"));
  const height = dimension(params.get("h"));
  const transform: MediaTransform | null =
    width || height ? { width, height, resize: resize ?? undefined } : null;
  const request: MediaRequest = {
    bucket,
    path,
    transform,
    access: params.get("a") === "1" ? "admin" : "user",
  };
  const expected = Buffer.from(sign(request));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return request;
}
