"use server";

import { createClient } from "@/lib/supabase/server";
import { embedTexts } from "@/lib/ai/siliconflow-client";

/**
 * Pipeline embedding'ов KB-страниц.
 *
 * `reembedKbPage(pageId)` — fire-and-forget action, вызывается
 * после успешного `kb_save_page` (см. saveKbPage в pages.ts).
 *   1. Тянет page row (RLS-protected) — берём plain_text.
 *   2. Chunks по headings (или fallback на paragraphs / hard-split).
 *   3. Batch-embed через SiliconFlow bge-m3.
 *   4. DELETE существующих embeddings + INSERT новых (atomic per-page
 *      replacement; HNSW index переидексируется автоматически).
 *
 * НЕ блокирует caller: вызывается через `void` без await — каркас
 * RPC завершится мгновенно, embedding pipeline побегает в background.
 * Если упадёт — лог в console + ai-pipeline просто пропустит этот
 * save; следующий save попробует ещё раз.
 */

/** Максимум tokens на chunk. bge-m3 поддерживает 8K, но для качества
 *  retrieval'а лучше держать ~500 — больше шансов что top-K вернёт
 *  релевантный chunk без слишком много шума. ≈500 токенов = ~2000
 *  characters на русском (≈4 chars/token у bge-m3). */
const MAX_CHUNK_CHARS = 2000;

/** Минимум — иначе chunks из 1 строки засирают индекс пустотой. */
const MIN_CHUNK_CHARS = 50;

export async function reembedKbPage(pageId: string): Promise<{
  chunks_count: number;
  error: string | null;
}> {
  const supabase = await createClient();
  const { data: page, error: pageErr } = await supabase
    .from("kb_pages")
    .select("id, account_id, title, plain_text")
    .eq("id", pageId)
    .is("deleted_at", null)
    .maybeSingle();
  if (pageErr) return { chunks_count: 0, error: pageErr.message };
  if (!page) return { chunks_count: 0, error: "Страница не найдена" };

  // Title идёт первым chunk'ом отдельно — даёт буст для запросов
  // вида «найди регламент про X» (title часто = topic).
  const titleChunk = (page.title ?? "").trim();
  const bodyText = (page.plain_text ?? "").trim();

  const chunks = chunkText(bodyText);
  // Если bodyText пустой — embedding'и не нужны (странице нечего
  // искать в content). Удаляем существующие и выходим.
  if (chunks.length === 0 && !titleChunk) {
    await supabase
      .from("kb_page_embeddings")
      .delete()
      .eq("page_id", pageId);
    return { chunks_count: 0, error: null };
  }

  const allChunks = titleChunk
    ? [`[Заголовок] ${titleChunk}`, ...chunks]
    : chunks;

  let embeddings: number[][];
  try {
    embeddings = await embedTexts(allChunks);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "embed error";
    console.error("[reembedKbPage] embed failed", { pageId, error: msg });
    return { chunks_count: 0, error: `Embed failed: ${msg}` };
  }

  if (embeddings.length !== allChunks.length) {
    return {
      chunks_count: 0,
      error: `Embed count mismatch: expected ${allChunks.length}, got ${embeddings.length}`,
    };
  }

  // Atomic replace per-page: delete existing → insert all chunks.
  // RLS policy kb_page_embeddings_write проверит account+permission.
  // Embedding-вектор передаётся в pgvector через текстовое
  // представление [n1,n2,...] — это canonical input format.
  const { error: delErr } = await supabase
    .from("kb_page_embeddings")
    .delete()
    .eq("page_id", pageId);
  if (delErr) return { chunks_count: 0, error: delErr.message };

  const rows = allChunks.map((chunk, idx) => ({
    page_id: pageId,
    account_id: page.account_id,
    chunk_index: idx,
    content_chunk: chunk,
    embedding: vectorLiteral(embeddings[idx]),
  }));

  const { error: insErr } = await supabase
    .from("kb_page_embeddings")
    .insert(rows as unknown as never);
  if (insErr) return { chunks_count: 0, error: insErr.message };

  return { chunks_count: rows.length, error: null };
}

/** Splits plain-text на chunks ~MAX_CHUNK_CHARS. Стратегия:
 *  1. Split по «пустой строке» (paragraph boundary).
 *  2. Greedy-объединение paragraph'ов в chunk пока не превысим лимит.
 *  3. Если один paragraph > лимита — hard-split по словам.
 *
 * Простая детерминированная стратегия — без semantic-aware
 * splitter'а. Достаточно для FTS-augmented retrieval; Sprint B+
 * можно усложнить (recursive splitter / heading-aware). */
function chunkText(text: string): string[] {
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

/** pgvector принимает текстовое представление вектора `[1.0,2.0,...]`.
 *  PostgREST через .insert() сериализует это как строку — pg-сторона
 *  парсит обратно в vector. Экономнее по байтам чем JSON-array of
 *  numbers (нет ключей). */
function vectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
