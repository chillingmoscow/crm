import { test } from "node:test";
import assert from "node:assert/strict";

import { buildPageChunks } from "./embeddings-chunk.ts";

test("buildPageChunks: тело префиксуется заголовком (contextualization)", () => {
  const chunks = buildPageChunks(
    "Неоновый демон",
    "Рецепт: вишня, бадьян, корица, апельсин.",
  );
  assert.equal(chunks.length, 1);
  assert.ok(
    chunks[0].startsWith("Неоновый демон\n\n"),
    "chunk должен начинаться с заголовка",
  );
  assert.ok(
    chunks[0].includes("Рецепт: вишня"),
    "chunk должен содержать тело",
  );
});

test("buildPageChunks: НЕ создаёт отдельный титульный chunk", () => {
  const chunks = buildPageChunks("Заголовок", "Достаточно длинное тело статьи про предмет обсуждения.");
  // Раньше было 2 chunk'а: '[Заголовок] X' + тело. Теперь один
  // контекстуализированный chunk, без пустого титульного.
  assert.equal(chunks.length, 1);
  assert.ok(!chunks.some((c) => c.startsWith("[Заголовок]")));
});

test("buildPageChunks: страница только с заголовком остаётся находимой", () => {
  const chunks = buildPageChunks("Только заголовок", "");
  assert.deepEqual(chunks, ["Только заголовок"]);
});

test("buildPageChunks: пустая страница → нет chunk'ов", () => {
  assert.deepEqual(buildPageChunks("", ""), []);
  assert.deepEqual(buildPageChunks(null, null), []);
  assert.deepEqual(buildPageChunks("   ", "  \n "), []);
});

test("buildPageChunks: тело без заголовка отдаётся как есть", () => {
  const body = "Тело без заголовка, достаточно длинное чтобы стать chunk'ом.";
  assert.deepEqual(buildPageChunks("", body), [body]);
});

test("buildPageChunks: каждый из нескольких chunk'ов несёт заголовок", () => {
  // Тело > MAX_CHUNK_CHARS (2000) → несколько chunk'ов; заголовок в каждом.
  const para = "Абзац текста. ".repeat(200); // ~2800 chars, один параграф
  const chunks = buildPageChunks("Тема", para);
  assert.ok(chunks.length >= 2, "ожидаем несколько chunk'ов");
  for (const c of chunks) {
    assert.ok(c.startsWith("Тема\n\n"), "каждый chunk с заголовком");
  }
});
