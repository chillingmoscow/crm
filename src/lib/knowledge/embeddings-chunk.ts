/**
 * Чистая (без server-зависимостей) логика нарезки KB-страницы на
 * chunk'и для эмбеддинга. Вынесена из `embeddings.ts` (там `"use
 * server"` + `@/`-импорты, которые node:test не резолвит) — чтобы
 * покрыть детерминированную часть unit-тестами.
 */

/** Максимум tokens на chunk. bge-m3 поддерживает 8K, но для качества
 *  retrieval'а лучше держать ~500 — больше шансов что top-K вернёт
 *  релевантный chunk без слишком много шума. ≈500 токенов = ~2000
 *  characters на русском (≈4 chars/token у bge-m3). */
export const MAX_CHUNK_CHARS = 2000;

/** Минимум — иначе chunks из 1 строки засирают индекс пустотой. */
export const MIN_CHUNK_CHARS = 50;

/**
 * Собирает финальный набор chunk'ов страницы для эмбеддинга.
 *
 * КАЖДЫЙ chunk тела префиксуется заголовком страницы
 * (`{title}\n\n{chunk}`) — «chunk contextualization». Зачем:
 *
 *  1. Любой найденный chunk несёт и заголовок, и содержимое — RAG-
 *     контекст всегда осмыслен, даже если совпал один chunk.
 *  2. Definition-style запросы («что такое X», где X в заголовке)
 *     поднимают chunk с ТЕЛОМ (он теперь содержит X), а не пустой
 *     титульный chunk. Раньше отдельный `[Заголовок] X`-chunk
 *     выигрывал top-K на keyword-match и отдавал LLM только заголовок
 *     без информации → «в базе нет ответа» при живом содержимом.
 *
 * Страница без тела (только заголовок) остаётся находимой — для неё
 * возвращаем один chunk из голого заголовка.
 */
export function buildPageChunks(
  title: string | null | undefined,
  plainText: string | null | undefined,
): string[] {
  const cleanTitle = (title ?? "").trim();
  const bodyChunks = chunkText((plainText ?? "").trim());
  if (bodyChunks.length === 0) {
    return cleanTitle ? [cleanTitle] : [];
  }
  if (!cleanTitle) return bodyChunks;
  return bodyChunks.map((chunk) => `${cleanTitle}\n\n${chunk}`);
}

/** Splits plain-text на chunks ~MAX_CHUNK_CHARS. Стратегия:
 *  1. Split по «пустой строке» (paragraph boundary).
 *  2. Greedy-объединение paragraph'ов в chunk пока не превысим лимит.
 *  3. Если один paragraph > лимита — hard-split по словам.
 *
 * Простая детерминированная стратегия — без semantic-aware
 * splitter'а. Достаточно для FTS-augmented retrieval; Sprint B+
 * можно усложнить (recursive splitter / heading-aware). */
export function chunkText(text: string): string[] {
  const cleaned = text.trim();
  if (cleaned.length < MIN_CHUNK_CHARS) {
    return cleaned ? [cleaned] : [];
  }

  // Paragraphs = blocks разделённые \n\n или \n (BlockNote'овский
  // blocksToPlainText возвращает blocks через \n).
  const paragraphs = cleaned
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  let buffer = "";

  for (const para of paragraphs) {
    // Параграф сам по себе больше лимита — режем по словам hard.
    if (para.length > MAX_CHUNK_CHARS) {
      if (buffer) {
        chunks.push(buffer);
        buffer = "";
      }
      const words = para.split(/\s+/);
      let wordBuf = "";
      for (const word of words) {
        if (wordBuf.length + word.length + 1 > MAX_CHUNK_CHARS) {
          if (wordBuf) chunks.push(wordBuf);
          wordBuf = word;
        } else {
          wordBuf = wordBuf ? `${wordBuf} ${word}` : word;
        }
      }
      if (wordBuf) chunks.push(wordBuf);
      continue;
    }
    // Можем уместить параграф в текущий chunk?
    if (buffer.length + para.length + 2 > MAX_CHUNK_CHARS) {
      if (buffer) chunks.push(buffer);
      buffer = para;
    } else {
      buffer = buffer ? `${buffer}\n\n${para}` : para;
    }
  }
  if (buffer) chunks.push(buffer);

  return chunks;
}
