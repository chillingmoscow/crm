import assert from "node:assert/strict";
import test from "node:test";

import {
  DISH_PHOTO_MAX_BYTES,
  decideDishPhoto,
  downloadDishPhoto,
  isAllowedDishPhotoUrl,
  readDishPhoto,
} from "./dish-photo.ts";

const url = (name: string) => `https://storage.yandexcloud.net/quickrestobase/nx815/dish/${name}.jpg`;
const place = (id: string, fullUrl: string | null) => ({ id, image: fullUrl ? { fullUrl } : null });

test("предел размера — 10 МБ", () => {
  assert.equal(DISH_PHOTO_MAX_BYTES, 10 * 1024 * 1024);
});

test("isAllowedDishPhotoUrl пускает только хранилище Quick Resto по https", () => {
  assert.equal(isAllowedDishPhotoUrl(url("a")), true);
  assert.equal(isAllowedDishPhotoUrl(url("a").replace("https:", "http:")), false);
  assert.equal(isAllowedDishPhotoUrl("https://evil.example/quickrestobase/a.jpg"), false);
  assert.equal(isAllowedDishPhotoUrl("https://storage.yandexcloud.net/other/a.jpg"), false);
  assert.equal(isAllowedDishPhotoUrl("https://storage.yandexcloud.net/quickrestobase/../other/a.jpg"), false);
  assert.equal(isAllowedDishPhotoUrl("https://user@storage.yandexcloud.net/quickrestobase/a.jpg"), false);
  assert.equal(isAllowedDishPhotoUrl("не ссылка"), false);
});

const card = (extra: Record<string, unknown>) => ({ id: 7, ...extra });
const photo = (u: string) => ({ kind: "photo", url: u });

test("readDishPhoto: фото терминала главнее других мест и доставки", () => {
  const dish = card({
    images: { viewPlaces: [place("XX", url("other")), place("FO", url("terminal"))] },
    wlcrmMedia: [{ fullUrl: url("delivery") }],
  });
  assert.deepEqual(readDishPhoto(dish, 7), photo(url("terminal")));
});

test("readDishPhoto: без терминала берётся другое место, потом доставка", () => {
  const dish = card({ images: { viewPlaces: [place("FO", null), place("XX", url("other"))] }, wlcrmMedia: [{ fullUrl: url("delivery") }] });
  assert.deepEqual(readDishPhoto(dish, 7), photo(url("other")));
  assert.deepEqual(readDishPhoto(card({ wlcrmMedia: [{ fullUrl: url("delivery") }] }), 7), photo(url("delivery")));
});

test("readDishPhoto: в карточке правда нет фото — none", () => {
  assert.deepEqual(readDishPhoto(card({ images: { viewPlaces: [] }, wlcrmMedia: [] }), 7), { kind: "none" });
  assert.deepEqual(readDishPhoto(card({ images: null }), 7), { kind: "none" });
  assert.deepEqual(readDishPhoto(card({}), 7), { kind: "none" });
});

test("readDishPhoto: пустой или чужой ответ — сбой чтения, а не «фото нет»", () => {
  assert.deepEqual(readDishPhoto({}, 7), { kind: "invalid" });
  assert.deepEqual(readDishPhoto(null, 7), { kind: "invalid" });
  assert.deepEqual(readDishPhoto("<html>", 7), { kind: "invalid" });
  assert.deepEqual(readDishPhoto({ id: 8, wlcrmMedia: [] }, 7), { kind: "invalid" });
});

test("readDishPhoto: неразрешённая ссылка пропускается; одни неразрешённые — refused", () => {
  const mixed = card({
    images: { viewPlaces: [place("FO", "https://evil.example/quickrestobase/a.jpg")] },
    wlcrmMedia: [{ fullUrl: url("delivery") }],
  });
  assert.deepEqual(readDishPhoto(mixed, 7), photo(url("delivery")));
  assert.deepEqual(
    readDishPhoto(card({ wlcrmMedia: [{ fullUrl: "http://storage.yandexcloud.net/quickrestobase/a.jpg" }] }), 7),
    { kind: "refused" },
  );
});

const none = { primaryImageFileId: null, photoSource: null, quickrestoPhotoUrl: null } as const;
const decide = (state: Parameters<typeof decideDishPhoto>[0], incoming: string | null) => decideDishPhoto(state, incoming);

test("decideDishPhoto: новое фото на пустой позиции — скачать и запомнить", () => {
  assert.deepEqual(decide(none, url("a")), { action: "download", remember: true });
});

test("decideDishPhoto: фото из Quick Resto сменилось — скачать", () => {
  assert.deepEqual(
    decide({ primaryImageFileId: "f", photoSource: "quickresto", quickrestoPhotoUrl: url("a") }, url("b")),
    { action: "download", remember: true },
  );
});

test("decideDishPhoto: ручное фото не трогаем и ссылку Quick Resto не запоминаем", () => {
  const manual = { primaryImageFileId: "f", photoSource: "manual", quickrestoPhotoUrl: null } as const;
  assert.deepEqual(decide(manual, url("a")), { action: "skip", remember: false });
  assert.deepEqual(decide(manual, null), { action: "skip", remember: false });
});

test("decideDishPhoto: ручное фото удалили — приезжает фото из Quick Resto", () => {
  // Удаление ставит photo_source = null; ссылку, пока фото было ручным, не запоминали.
  assert.deepEqual(decide(none, url("a")), { action: "download", remember: true });
});

test("decideDishPhoto: «manual» без файла — не ручное фото", () => {
  assert.deepEqual(
    decide({ primaryImageFileId: null, photoSource: "manual", quickrestoPhotoUrl: null }, url("a")),
    { action: "download", remember: true },
  );
});

test("decideDishPhoto: то же фото — пропуск", () => {
  assert.deepEqual(
    decide({ primaryImageFileId: "f", photoSource: "quickresto", quickrestoPhotoUrl: url("a") }, url("a")),
    { action: "skip", remember: true },
  );
});

test("decideDishPhoto: снятое пользователем фото не возвращается, новое — приезжает", () => {
  const removed = { primaryImageFileId: null, photoSource: null, quickrestoPhotoUrl: url("a") } as const;
  assert.deepEqual(decide(removed, url("a")), { action: "skip", remember: true });
  assert.deepEqual(decide(removed, url("b")), { action: "download", remember: true });
});

test("decideDishPhoto: в Quick Resto фото убрали — снимаем только свою копию", () => {
  assert.deepEqual(
    decide({ primaryImageFileId: "f", photoSource: "quickresto", quickrestoPhotoUrl: url("a") }, null),
    { action: "clear", remember: true },
  );
  assert.deepEqual(decide(none, null), { action: "skip", remember: true });
});

const fakeFetch =
  (body: BodyInit | null, headers: Record<string, string>, status = 200, seen: string[] = []) =>
  (async (input: string | URL | Request) => {
    seen.push(String(input));
    return new Response(body, { status, headers });
  }) as typeof fetch;

test("downloadDishPhoto скачивает картинку и определяет расширение", async () => {
  const photo = await downloadDishPhoto(url("a"), fakeFetch(new Uint8Array([1, 2, 3]), { "content-type": "image/jpeg" }));
  assert.equal(photo.ext, "jpg");
  assert.equal(photo.contentType, "image/jpeg");
  assert.deepEqual([...photo.bytes], [1, 2, 3]);
});

test("downloadDishPhoto не ходит по чужому адресу", async () => {
  const seen: string[] = [];
  await assert.rejects(
    downloadDishPhoto("https://evil.example/quickrestobase/a.jpg", fakeFetch(new Uint8Array([1]), { "content-type": "image/jpeg" }, 200, seen)),
    /не из хранилища/,
  );
  assert.equal(seen.length, 0);
});

test("downloadDishPhoto отказывает не картинке", async () => {
  await assert.rejects(
    downloadDishPhoto(url("a"), fakeFetch("<html></html>", { "content-type": "text/html; charset=utf-8" })),
    /не картинка/,
  );
  await assert.rejects(
    downloadDishPhoto(url("a"), fakeFetch("<svg/>", { "content-type": "image/svg+xml" })),
    /не картинка/,
  );
});

test("downloadDishPhoto отказывает файлу больше 10 МБ — по заголовку и по факту", async () => {
  await assert.rejects(
    downloadDishPhoto(url("a"), fakeFetch(new Uint8Array([1]), { "content-type": "image/png", "content-length": String(DISH_PHOTO_MAX_BYTES + 1) })),
    /больше 10 МБ/,
  );
  await assert.rejects(
    downloadDishPhoto(url("a"), fakeFetch(new Uint8Array(DISH_PHOTO_MAX_BYTES + 1), { "content-type": "image/png" })),
    /больше 10 МБ/,
  );
});

test("downloadDishPhoto: ошибка хранилища и пустой файл", async () => {
  await assert.rejects(downloadDishPhoto(url("a"), fakeFetch(null, {}, 404)), /не скачалось \(404\)/);
  await assert.rejects(downloadDishPhoto(url("a"), fakeFetch(new Uint8Array(0), { "content-type": "image/jpeg" })), /Пустой файл/);
});
