"use server";

import { createClient } from "@/lib/supabase/server";
import { embedTexts } from "@/lib/ai/siliconflow-client";
import { runWithConcurrency } from "@/lib/run-with-concurrency";

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
    .select("id, account_id, title, plain_text, updated_at")
    .eq("id", pageId)
    .is("deleted_at", null)
    .maybeSingle();
  if (pageErr) return { chunks_count: 0, error: pageErr.message };
  if (!page) return { chunks_count: 0, error: "Страница не найдена" };

  // Snapshot updated_at ДО embedding-network-trip — потом передаём в
  // RPC как freshness-token. Если страница изменится за это время,
  // RPC вернёт 'stale' и не перезатрёт свежие embeddings из новой
  // (более быстрой) job'ы. Решает Codex #47 P1 «serialize re-embed
  // jobs for the same page».
  const snapshotUpdatedAt = page.updated_at;

  // Title идёт первым chunk'ом отдельно — даёт буст для запросов
  // вида «найди регламент про X» (title часто = topic).
  const titleChunk = (page.title ?? "").trim();
  const bodyText = (page.plain_text ?? "").trim();

  const chunks = chunkText(bodyText);
  const allChunks =
    chunks.length === 0 && !titleChunk
      ? []
      : titleChunk
        ? [`[Заголовок] ${titleChunk}`, ...chunks]
        : chunks;

  // Content-hash dedup. Если существующие embeddings в БД уже содержат
  // ровно те же chunk'и (ту же индексацию + тот же текст), — пропускаем
  // SiliconFlow API и RPC: re-embed для unchanged-content'а — чистое
  // burn'инг квоты. Срабатывает на каждом save'е, который не менял
  // `plain_text` (изменили только icon/title через нормализацию,
  // добавили comment-mark, обновили properties — saveKbPage всё равно
  // дёргает reembedKbPage).
  //
  // Стоимость guard'а — один SELECT (~10мс), экономия — embed-roundtrip
  // (~500мс на SiliconFlow) + RPC (~10мс) + квота bge-m3.
  //
  // Guard НЕ заменяет существующий `p_expected_updated_at`-stale-guard
  // в RPC: тот защищает от race'ов между параллельными reembed-job'ами,
  // эта проверка — от reembed'а одного и того же контента подряд.
  const { data: existingChunks } = await supabase
    .from("kb_page_embeddings")
    .select("chunk_index, content_chunk")
    .eq("page_id", pageId)
    .order("chunk_index", { ascending: true });
  if (existingChunks && existingChunks.length === allChunks.length) {
    let same = true;
    for (let i = 0; i < allChunks.length; i++) {
      if (
        existingChunks[i].chunk_index !== i ||
        existingChunks[i].content_chunk !== allChunks[i]
      ) {
        same = false;
        break;
      }
    }
    if (same) {
      // Pure content no-op: текст не менялся, embeddings актуальны.
      return { chunks_count: allChunks.length, error: null };
    }
  }

  // Embed только если есть что embed'ить — иначе шлём пустой массив,
  // RPC очистит существующие chunks (страница опустошена).
  let embeddings: number[][] = [];
  if (allChunks.length > 0) {
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
  }

  // Atomic replace + freshness-guard через RPC kb_replace_page_embeddings.
  // PG-функция неявно транзакционная — DELETE+INSERT либо оба commit,
  // либо оба rollback (Codex #47 P1 atomicity). p_expected_updated_at =
  // snapshot ДО embedding-trip (Codex #47 P1 serialization — старая
  // background-job со stale-content получит 'stale' и тихо пропустит).
  const chunkPayload = allChunks.map((chunk, idx) => ({
    chunk_index: idx,
    content_chunk: chunk,
    embedding: vectorLiteral(embeddings[idx]),
  }));

  const { data: result, error: rpcErr } = await supabase.rpc(
    "kb_replace_page_embeddings",
    {
      p_page_id: pageId,
      p_expected_updated_at: snapshotUpdatedAt as unknown as string,
      p_chunks: chunkPayload as unknown as never,
    },
  );
  if (rpcErr) return { chunks_count: 0, error: rpcErr.message };

  const status = (result as unknown as string) ?? "unknown";
  if (status === "stale") {
    // Newer save проехал мимо нас — это ОК, не ошибка. Свежий re-embed
    // уже запущен или вот-вот запустится из той save'ы.
    return { chunks_count: 0, error: null };
  }
  if (status !== "ok") {
    return { chunks_count: 0, error: `Replace status: ${status}` };
  }

  return { chunks_count: chunkPayload.length, error: null };
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

/**
 * Массовая переиндексация всех живых страниц активного account для
 * AI-поиска. Нужна, потому что `reembedKbPage` — fire-and-forget
 * после save'а: страницы, созданные ДО включения AI (или до смены
 * embedding-модели), эмбеддингов не имеют, и RAG отвечает «в базе
 * нет страниц». Кнопка на дашборде дёргает этот экшен один раз.
 *
 * Gate: `kb.ask_ai` (потребитель эмбеддингов — RAG) + accounts
 * .ai_enabled, паритет с `askKbAi`. Запись в kb_page_embeddings
 * дополнительно гейтится RLS (`kb.create_pages`) — экшен под RLS-
 * клиентом, прав writer'а это не обходит.
 *
 * Best-effort: ошибка на одной странице не прерывает остальные
 * (в отличие от abort-on-throw у runWithConcurrency — поэтому
 * worker ловит сам). Concurrency 3 — бережём SiliconFlow rate-limit
 * и Supabase pool. Content-hash guard внутри reembedKbPage делает
 * повторный вызов на уже-проиндексированной странице дешёвым (один
 * SELECT), так что кнопку безопасно жать повторно.
 */
export async function reembedAllKbPages(): Promise<{
  total: number;
  embedded: number;
  skipped: number;
  failed: number;
  error: string | null;
}> {
  const empty = { total: 0, embedded: 0, skipped: 0, failed: 0 };
  const supabase = await createClient();

  const [{ data: canAsk }, { data: canWrite }, { data: accountId }] =
    await Promise.all([
      supabase.rpc("has_permission", { permission_code: "kb.ask_ai" }),
      supabase.rpc("has_permission", { permission_code: "kb.create_pages" }),
      supabase.rpc("get_active_account_id"),
    ]);
  if (!canAsk) {
    return { ...empty, error: "Нет права использовать AI" };
  }
  // Запись в kb_page_embeddings гейтится RLS на kb.create_pages —
  // проверяем заранее, чтобы не словить N RLS-ошибок построчно.
  if (!canWrite) {
    return {
      ...empty,
      error: "Нужно право создавать страницы базы знаний",
    };
  }
  if (!accountId) {
    return { ...empty, error: "Нет активного account" };
  }
  const { data: account } = await supabase
    .from("accounts")
    .select("ai_enabled")
    .eq("id", accountId as unknown as string)
    .maybeSingle();
  if (!account?.ai_enabled) {
    return { ...empty, error: "AI отключён для этого аккаунта" };
  }

  // RLS scope'ит выборку к активному account; берём только живые.
  const { data: pages, error: pagesErr } = await supabase
    .from("kb_pages")
    .select("id")
    .is("deleted_at", null);
  if (pagesErr) return { ...empty, error: pagesErr.message };

  const ids = (pages ?? []).map((p) => p.id as string);
  if (ids.length === 0) {
    return { ...empty, error: null };
  }

  let embedded = 0;
  let skipped = 0;
  let failed = 0;

  await runWithConcurrency(ids, 3, async (pageId) => {
    try {
      const { chunks_count, error } = await reembedKbPage(pageId);
      if (error) {
        failed += 1;
        console.error("[reembedAllKbPages] page failed", { pageId, error });
        return;
      }
      if (chunks_count > 0) embedded += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      console.error("[reembedAllKbPages] page crashed", {
        pageId,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  });

  return {
    total: ids.length,
    embedded,
    skipped,
    failed,
    error: null,
  };
}

/** pgvector принимает текстовое представление вектора `[1.0,2.0,...]`.
 *  PostgREST через .insert() сериализует это как строку — pg-сторона
 *  парсит обратно в vector. Экономнее по байтам чем JSON-array of
 *  numbers (нет ключей). */
function vectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
