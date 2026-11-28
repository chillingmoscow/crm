import test from "node:test";
import assert from "node:assert/strict";

import { KB_TRASH_BUCKET_LABEL, kbTrashBucket, kbTrashMatches } from "./trash.ts";

const now = new Date(2026, 10, 27, 15, 0); // 27 ноября, 15:00 по местному

test("kbTrashBucket: сегодня, вчера, неделя, ранее", () => {
  assert.equal(kbTrashBucket(new Date(2026, 10, 27, 0, 5).toISOString(), now), "today");
  assert.equal(kbTrashBucket(new Date(2026, 10, 26, 23, 50).toISOString(), now), "yesterday");
  assert.equal(kbTrashBucket(new Date(2026, 10, 20, 12, 0).toISOString(), now), "week");
  assert.equal(kbTrashBucket(new Date(2026, 10, 19, 12, 0).toISOString(), now), "earlier");
  assert.equal(kbTrashBucket(null, now), "earlier");
});

test("KB_TRASH_BUCKET_LABEL: подписи групп", () => {
  assert.deepEqual(KB_TRASH_BUCKET_LABEL, {
    today: "Сегодня",
    yesterday: "Вчера",
    week: "За неделю",
    earlier: "Ранее",
  });
});

test("kbTrashMatches: без учёта регистра и «ё»", () => {
  assert.equal(kbTrashMatches("Ёлка у входа", "елка"), true);
  assert.equal(kbTrashMatches("Открытие бара", "БАР"), true);
  assert.equal(kbTrashMatches("Открытие бара", "кухня"), false);
  assert.equal(kbTrashMatches("Что угодно", "  "), true);
  assert.equal(kbTrashMatches(null, "бар"), false);
});
