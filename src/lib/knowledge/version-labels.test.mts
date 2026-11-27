import test from "node:test";
import assert from "node:assert/strict";

import { kbChangeKindLabel, kbVersionDeltaLabel } from "./version-labels.ts";

const plain = (s: string) => s.replace(/ /g, " ");

test("kbVersionDeltaLabel: первая версия и без изменений — нейтрально", () => {
  assert.deepEqual(kbVersionDeltaLabel(null), { text: "Первая версия", tone: "neutral" });
  assert.deepEqual(kbVersionDeltaLabel(0), { text: "Без изменения длины", tone: "neutral" });
});

test("kbVersionDeltaLabel: прибавка и убыль символов", () => {
  const plus = kbVersionDeltaLabel(120);
  assert.equal(plain(plus.text), "+120 символов");
  assert.equal(plus.tone, "success");
  const minus = kbVersionDeltaLabel(-1);
  assert.equal(plain(minus.text), "−1 символ");
  assert.equal(minus.tone, "danger");
});

test("kbChangeKindLabel: подписи видов правки с заглавной буквы", () => {
  assert.equal(kbChangeKindLabel("title"), "Заголовок");
  assert.equal(kbChangeKindLabel("properties"), "Свойства");
  assert.equal(kbChangeKindLabel("icon"), "Значок");
  assert.equal(kbChangeKindLabel("restore"), "Восстановление");
  assert.equal(kbChangeKindLabel("content"), "Текст");
  assert.equal(kbChangeKindLabel("что-то новое"), "Текст");
});
