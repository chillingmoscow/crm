import assert from "node:assert/strict";
import test from "node:test";

import {
  DISH_PHOTO_MAX_BYTES,
  decideDishPhoto,
  isAllowedDishPhotoUrl,
  pickDishPhotoUrl,
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

test("pickDishPhotoUrl: фото терминала главнее других мест и доставки", () => {
  const dish = {
    images: { viewPlaces: [place("XX", url("other")), place("FO", url("terminal"))] },
    wlcrmMedia: [{ fullUrl: url("delivery") }],
  };
  assert.equal(pickDishPhotoUrl(dish), url("terminal"));
});

test("pickDishPhotoUrl: без терминала берётся другое место", () => {
  const dish = { images: { viewPlaces: [place("FO", null), place("XX", url("other"))] }, wlcrmMedia: [{ fullUrl: url("delivery") }] };
  assert.equal(pickDishPhotoUrl(dish), url("other"));
});

test("pickDishPhotoUrl: только фото доставки", () => {
  assert.equal(pickDishPhotoUrl({ wlcrmMedia: [{ fullUrl: url("delivery") }] }), url("delivery"));
});

test("pickDishPhotoUrl: нет фото — null", () => {
  assert.equal(pickDishPhotoUrl({ images: { viewPlaces: [] }, wlcrmMedia: [] }), null);
  assert.equal(pickDishPhotoUrl({ images: null }), null);
  assert.equal(pickDishPhotoUrl({}), null);
  assert.equal(pickDishPhotoUrl(null), null);
  assert.equal(pickDishPhotoUrl("dish"), null);
});

test("pickDishPhotoUrl: неразрешённая ссылка пропускается", () => {
  const dish = {
    images: { viewPlaces: [place("FO", "https://evil.example/quickrestobase/a.jpg")] },
    wlcrmMedia: [{ fullUrl: url("delivery") }],
  };
  assert.equal(pickDishPhotoUrl(dish), url("delivery"));
  assert.equal(pickDishPhotoUrl({ wlcrmMedia: [{ fullUrl: "http://storage.yandexcloud.net/quickrestobase/a.jpg" }] }), null);
});

const none = { primaryImageFileId: null, photoSource: null, quickrestoPhotoUrl: null } as const;

test("decideDishPhoto: новое фото на пустой позиции — скачать", () => {
  assert.equal(decideDishPhoto(none, url("a")), "download");
});

test("decideDishPhoto: фото из Quick Resto сменилось — скачать", () => {
  assert.equal(
    decideDishPhoto({ primaryImageFileId: "f", photoSource: "quickresto", quickrestoPhotoUrl: url("a") }, url("b")),
    "download",
  );
});

test("decideDishPhoto: ручное фото не трогаем", () => {
  const manual = { primaryImageFileId: "f", photoSource: "manual", quickrestoPhotoUrl: null } as const;
  assert.equal(decideDishPhoto(manual, url("a")), "skip");
  assert.equal(decideDishPhoto(manual, null), "skip");
});

test("decideDishPhoto: то же фото — пропуск", () => {
  assert.equal(
    decideDishPhoto({ primaryImageFileId: "f", photoSource: "quickresto", quickrestoPhotoUrl: url("a") }, url("a")),
    "skip",
  );
});

test("decideDishPhoto: снятое пользователем фото не возвращается, новое — приезжает", () => {
  const removed = { primaryImageFileId: null, photoSource: null, quickrestoPhotoUrl: url("a") } as const;
  assert.equal(decideDishPhoto(removed, url("a")), "skip");
  assert.equal(decideDishPhoto(removed, url("b")), "download");
});

test("decideDishPhoto: в Quick Resto фото убрали — снимаем только свою копию", () => {
  assert.equal(
    decideDishPhoto({ primaryImageFileId: "f", photoSource: "quickresto", quickrestoPhotoUrl: url("a") }, null),
    "clear",
  );
  assert.equal(decideDishPhoto(none, null), "skip");
});
