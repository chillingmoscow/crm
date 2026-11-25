// Фото блюда из карточки бэк-офиса Quick Resto: какую ссылку взять и что
// с ней делать. Чистые функции — без сети и базы.
//
// Карточка (`warehouse.nomenclature.dish/read` с className) держит фото в
// двух местах: `images.viewPlaces[]` (место "FO" — «Терминал», кадр, который
// выбрал ресторан) и `wlcrmMedia[]` (фото для приложения доставки). Файлы
// лежат в общедоступном хранилище storage.yandexcloud.net/quickrestobase/.

export const DISH_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

const PHOTO_HOST = "storage.yandexcloud.net";
const PHOTO_PATH_PREFIX = "/quickrestobase/";

/** Скачиваем только из хранилища Quick Resto и только по https. */
export function isAllowedDishPhotoUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.hostname === PHOTO_HOST &&
    parsed.port === "" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.pathname.startsWith(PHOTO_PATH_PREFIX)
  );
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

export type DishPhotoReading =
  /** Ответ не похож на карточку этого блюда: пустой, не JSON, чужой id. Сбой чтения. */
  | { kind: "invalid" }
  /** Карточка прочитана, фото в ней нет. */
  | { kind: "none" }
  /** Фото есть, но ни одна ссылка не из хранилища Quick Resto — не качаем и ничего не снимаем. */
  | { kind: "refused" }
  | { kind: "photo"; url: string };

/**
 * Фото из карточки блюда: «Терминал», иначе первое другое место показа, иначе
 * первое фото доставки; неразрешённые ссылки пропускаются. Пустой ответ
 * бэк-офиса (на проде бывает) — не «фото убрали», а сбой чтения.
 */
export function readDishPhoto(dish: unknown, expectedId: number): DishPhotoReading {
  const data = record(dish);
  if (!data || data.id !== expectedId) return { kind: "invalid" };

  const rawPlaces = record(data.images)?.viewPlaces;
  const places = Array.isArray(rawPlaces)
    ? rawPlaces.map(record).filter((p): p is Record<string, unknown> => p !== null)
    : [];
  const placeUrl = (place: Record<string, unknown>) => record(place.image)?.fullUrl;
  const candidates: unknown[] = [
    ...places.filter((place) => place.id === "FO").map(placeUrl),
    ...places.filter((place) => place.id !== "FO").map(placeUrl),
    ...(Array.isArray(data.wlcrmMedia) ? data.wlcrmMedia.map((media) => record(media)?.fullUrl) : []),
  ];
  const links = candidates.filter((value): value is string => typeof value === "string" && value.trim() !== "");
  const allowed = links.find(isAllowedDishPhotoUrl);
  if (allowed) return { kind: "photo", url: allowed };
  return links.length > 0 ? { kind: "refused" } : { kind: "none" };
}

export type DishPhotoState = {
  primaryImageFileId: string | null;
  photoSource: "manual" | "quickresto" | null;
  /** Ссылка фото Quick Resto при прошлой проверке (даже если фото потом сняли). */
  quickrestoPhotoUrl: string | null;
};

export type DishPhotoDecision = {
  action: "download" | "clear" | "skip";
  /**
   * Запомнить `incoming` как последнюю ссылку Quick Resto — поэтому снятое
   * руками фото из Quick Resto не возвращается, пока его там не заменят. Пока
   * у позиции ручное фото, не запоминаем: удалят ручное — придёт фото из QR.
   */
  remember: boolean;
};

export function decideDishPhoto(state: DishPhotoState, incoming: string | null): DishPhotoDecision {
  // «manual» без файла (старая запись, файл удалён) ручным фото не считается.
  if (state.photoSource === "manual" && state.primaryImageFileId !== null) return { action: "skip", remember: false };
  if (incoming === null) return { action: state.photoSource === "quickresto" ? "clear" : "skip", remember: true };
  if (incoming === state.quickrestoPhotoUrl) return { action: "skip", remember: true };
  return { action: "download", remember: true };
}

const DOWNLOAD_TIMEOUT_MS = 20_000;

/** Только форматы, которые каталог умеет показать. */
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type DownloadedDishPhoto = { bytes: Uint8Array; contentType: string; ext: string };

/**
 * Скачать фото: только разрешённый адрес, без перехода по редиректам (иначе
 * проверка адреса ничего не значит), только картинка, не больше 10 МБ —
 * и по заголовку, и по факту прочитанного.
 */
export async function downloadDishPhoto(url: string, fetchImpl: typeof fetch = fetch): Promise<DownloadedDishPhoto> {
  if (!isAllowedDishPhotoUrl(url)) throw new Error("Адрес фото не из хранилища Quick Resto");
  const response = await fetchImpl(url, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Фото не скачалось (${response.status})`);
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = IMAGE_EXTENSIONS[contentType];
  if (!ext) {
    await response.body?.cancel();
    throw new Error("По ссылке не картинка");
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > DISH_PHOTO_MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("Фото больше 10 МБ");
  }
  if (!response.body) throw new Error("Пустой файл фото");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > DISH_PHOTO_MAX_BYTES) {
      await reader.cancel();
      throw new Error("Фото больше 10 МБ");
    }
    chunks.push(value);
  }
  if (size === 0) throw new Error("Пустой файл фото");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, contentType, ext };
}
