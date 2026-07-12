"use server";

import { createClient } from "@/lib/supabase/server";
import { embedTexts } from "@/lib/ai/siliconflow-client";
import { getDeepseekClient, DEEPSEEK_MODELS } from "@/lib/ai/deepseek-client";

/**
 * RAG: «Спросить базу знаний».
 *
 * Pipeline:
 *   1. Permission check (kb.ask_ai) + accounts.ai_enabled.
 *   2. Embed запроса юзера через SiliconFlow bge-m3.
 *   3. Top-K cosine search через `kb_search_embeddings` RPC
 *      (tenant-isolation в самой RPC).
 *   4. Передаём top-K chunks как context в DeepSeek deepseek-chat
 *      с инструкцией ответить ТОЛЬКО на основе контекста + указать
 *      sources.
 *   5. Возвращаем answer + sources (page metadata для рендера ссылок
 *      в UI).
 *
 * НЕ стримит — для search-style запросов (~500-1000 output tokens,
 * ~3-8s) одношаговый response норм. Loader на UI покрывает.
 */

export interface KbAiSource {
  page_id: string;
  page_title: string;
  page_slug: string;
  page_icon: string | null;
  page_icon_color: string | null;
  /** Лучший cosine similarity среди chunks этой страницы. */
  similarity: number;
}

const TOP_K = 5;

/** Сколько топ-страниц-источников разворачивать в полный текст для
 *  LLM-контекста. 3 — баланс между полнотой и token-бюджетом. */
const MAX_CONTEXT_PAGES = 3;

/** Верхняя граница символов контекста (~1.5-2K токенов на русском).
 *  Тело топ-страниц режется по этой квоте, чтобы не раздувать prompt. */
const MAX_CONTEXT_CHARS = 6000;

const SYSTEM_PROMPT =
  "Ты ассистент для базы знаний ресторана. Отвечай на вопрос " +
  "пользователя, ОПИРАЯСЬ ТОЛЬКО на предоставленный контекст из " +
  "внутренних страниц базы. Если контекст не содержит ответа — честно " +
  "скажи «В базе знаний нет ответа на этот вопрос», не выдумывай. " +
  "Отвечай кратко (2-5 предложений), на русском, без markdown.";

export async function askKbAi(input: {
  question: string;
}): Promise<{
  answer: string | null;
  sources: KbAiSource[];
  error: string | null;
}> {
  const question = (input.question ?? "").trim();
  if (question.length === 0) {
    return { answer: null, sources: [], error: "Пустой вопрос" };
  }
  if (question.length > 500) {
    // 500 chars — комфортный максимум для search-query, всё что выше
    // обычно не вопрос а копипаст полтекста.
    return { answer: null, sources: [], error: "Вопрос слишком длинный (макс 500 символов)" };
  }

  const supabase = await createClient();

  // Двойной gate: kb.ask_ai permission + accounts.ai_enabled.
  const [{ data: canAsk }, { data: accountId }] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "kb.ask_ai" }),
    supabase.rpc("get_active_account_id"),
  ]);
  if (!canAsk) {
    return { answer: null, sources: [], error: "Нет права задавать AI-вопросы" };
  }
  if (!accountId) {
    return { answer: null, sources: [], error: "Нет активного account" };
  }
  const { data: account } = await supabase
    .from("accounts")
    .select("ai_enabled")
    .eq("id", accountId as unknown as string)
    .maybeSingle();
  if (!account?.ai_enabled) {
    return { answer: null, sources: [], error: "AI отключён для этого аккаунта" };
  }

  // 1. Embed query.
  let queryEmbedding: number[];
  try {
    const embeddings = await embedTexts([question]);
    if (!embeddings[0]) {
      return { answer: null, sources: [], error: "Empty embedding" };
    }
    queryEmbedding = embeddings[0];
  } catch (err) {
    const msg = err instanceof Error ? err.message : "embed error";
    // Реальную причину (напр. 401 от SiliconFlow) — в серверный лог,
    // пользователю — дружелюбный текст без кода/тела ответа провайдера.
    console.error("[askKbAi] embed failed", { error: msg });
    return {
      answer: null,
      sources: [],
      error: "ИИ-поиск временно недоступен. Обратитесь к администратору.",
    };
  }

  // 2. Top-K cosine search через RPC. Передаём вектор через
  // вспомогательную RPC-обёртку — чтобы pgvector распарсил литерал.
  const { data: hits, error: searchErr } = await supabase.rpc(
    "kb_search_embeddings",
    {
      p_query_embedding: vectorLiteral(queryEmbedding) as unknown as never,
      p_limit: TOP_K,
    },
  );
  if (searchErr) {
    console.error("[askKbAi] embedding search failed", {
      error: searchErr.message,
    });
    return {
      answer: null,
      sources: [],
      error: "ИИ-поиск временно недоступен. Обратитесь к администратору.",
    };
  }

  type Hit = {
    page_id: string;
    chunk_index: number;
    content_chunk: string;
    page_title: string;
    page_slug: string;
    page_icon: string | null;
    page_icon_color: string | null;
    similarity: number;
  };
  const rows = (hits as unknown as Hit[]) ?? [];

  if (rows.length === 0) {
    return {
      answer: "В базе знаний пока нет страниц для ответа.",
      sources: [],
      error: null,
    };
  }

  // 3a. Sources — дедуп по page_id, лучший similarity (для UI-ссылок).
  //     Порядок распределения = порядок появления hits (по similarity).
  const sourceMap = new Map<string, KbAiSource>();
  const orderedPageIds: string[] = [];
  for (const hit of rows) {
    if (!sourceMap.has(hit.page_id)) orderedPageIds.push(hit.page_id);
    const existing = sourceMap.get(hit.page_id);
    if (!existing || existing.similarity < hit.similarity) {
      sourceMap.set(hit.page_id, {
        page_id: hit.page_id,
        page_title: hit.page_title,
        page_slug: hit.page_slug,
        page_icon: hit.page_icon,
        page_icon_color: hit.page_icon_color,
        similarity: hit.similarity,
      });
    }
  }
  const sources = Array.from(sourceMap.values()).sort(
    (a, b) => b.similarity - a.similarity,
  );

  // 3b. Сборка LLM-context. НЕ ограничиваемся совпавшим chunk'ом:
  //     подтягиваем ПОЛНОЕ тело топ-N страниц-источников. Иначе
  //     definition-style запрос («что такое X»), совпавший только с
  //     заголовочным chunk'ом, отдал бы LLM один заголовок без
  //     содержимого → «в базе нет ответа» при живом теле страницы.
  //     Тело склеиваем из всех chunk'ов страницы по chunk_index; RLS
  //     на kb_page_embeddings — account-scoped (kb.ask_ai уже
  //     проверен выше), так что прямой select безопасен.
  const contextPageIds = orderedPageIds.slice(0, MAX_CONTEXT_PAGES);
  const titleById = new Map(rows.map((h) => [h.page_id, h.page_title]));

  const { data: bodyRows } = await supabase
    .from("kb_page_embeddings")
    .select("page_id, chunk_index, content_chunk")
    .in("page_id", contextPageIds)
    .order("chunk_index", { ascending: true });

  const bodyByPage = new Map<string, string[]>();
  for (const r of (bodyRows as { page_id: string; content_chunk: string }[]) ??
    []) {
    const arr = bodyByPage.get(r.page_id) ?? [];
    arr.push(r.content_chunk);
    bodyByPage.set(r.page_id, arr);
  }

  // Совпавшие chunk'и по страницам (в порядке similarity из RPC) —
  // ставим их ПЕРВЫМИ в тело страницы. Иначе при длинной странице,
  // где совпал поздний chunk, склейка «с 0-го + обрезка по бюджету»
  // могла выкинуть сам найденный ответ из контекста (Codex P2).
  const matchedByPage = new Map<string, string[]>();
  for (const hit of rows) {
    const arr = matchedByPage.get(hit.page_id) ?? [];
    arr.push(hit.content_chunk);
    matchedByPage.set(hit.page_id, arr);
  }

  const contextLines: string[] = [];
  let budget = MAX_CONTEXT_CHARS;
  for (const pageId of contextPageIds) {
    const matched = matchedByPage.get(pageId) ?? [];
    const full = bodyByPage.get(pageId) ?? [];
    // Matched-first, затем остальное тело по chunk_index (без повторов).
    // Fallback на matched, если тело не достали (RLS/пустой ответ) —
    // контекст не должен исчезнуть.
    const seen = new Set(matched);
    const ordered = [...matched, ...full.filter((c) => !seen.has(c))];
    const body = ordered.join("\n");
    if (!body) continue;
    const slice = body.slice(0, Math.max(0, budget));
    if (!slice) break;
    contextLines.push(`### ${titleById.get(pageId) ?? ""}\n${slice}`);
    budget -= slice.length;
    if (budget <= 0) break;
  }

  const userPrompt = `Контекст из базы знаний:\n\n${contextLines.join("\n\n---\n\n")}\n\nВопрос: ${question}`;

  // 4. Запрос к DeepSeek.
  let client;
  try {
    client = getDeepseekClient();
  } catch (err) {
    console.error("[askKbAi] deepseek client init failed", {
      error: err instanceof Error ? err.message : "client error",
    });
    return {
      answer: null,
      sources,
      error: "ИИ-поиск временно недоступен. Обратитесь к администратору.",
    };
  }

  try {
    const response = await client.chat.completions.create({
      model: DEEPSEEK_MODELS.chat,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 800,
    });

    const answer = response.choices[0]?.message?.content?.trim() ?? "";
    if (!answer) {
      return { answer: null, sources, error: "Пустой ответ от AI" };
    }
    return { answer, sources, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Неизвестная ошибка AI";
    console.error("[askKbAi] deepseek completion failed", {
      error: message,
    });
    return {
      answer: null,
      sources,
      error: "ИИ-поиск временно недоступен. Обратитесь к администратору.",
    };
  }
}

/** Канонический pgvector text format `[1.0,2.0,...]`. */
function vectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
