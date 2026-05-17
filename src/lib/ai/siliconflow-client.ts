import "server-only";

import OpenAI from "openai";

/**
 * SiliconFlow client для embeddings (OpenAI-compatible API).
 *
 * ВАЖНО про домен: у SiliconFlow две независимые платформы —
 * `api.siliconflow.cn` (Китай) и `api.siliconflow.com`
 * (международная). Ключи НЕ переносимы между ними: ключ от .com на
 * .cn отвечает `401 "Api key is invalid"`. Наш аккаунт — на .com,
 * поэтому baseURL = .com (раньше был .cn → отсюда 401 в AI-поиске).
 *
 * Модель: каталог embedding'ов на .com — Qwen3-Embedding
 * (8B/4B/0.6B), bge-m3 там НЕ существует (400 "Model does not
 * exist"). Берём `Qwen/Qwen3-Embedding-0.6B` — ровно 1024 dim,
 * совпадает со схемой `kb_page_embeddings.embedding vector(1024)`
 * (миграция 072/160), ALTER COLUMN не нужен. Multilingual (RU/EN/…).
 *
 * ENV: SILICONFLOW_API_KEY (Coolify env var на проде) — ключ должен
 * быть создан на платформе siliconflow.com.
 */

const SILICONFLOW_BASE_URL = "https://api.siliconflow.com/v1";

let cachedClient: OpenAI | null = null;

export function getSiliconflowClient(): OpenAI {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    throw new Error(
      "SILICONFLOW_API_KEY не выставлен. Добавьте в .env.local (dev) или Coolify Env Variables (prod).",
    );
  }
  cachedClient = new OpenAI({
    apiKey,
    baseURL: SILICONFLOW_BASE_URL,
  });
  return cachedClient;
}

/** Embedding-модели SiliconFlow (.com).
 *
 *   Qwen3-Embedding-0.6B — 1024 dim, multilingual. Дефолт для RAG.
 *
 * Размерность зашита в схему `kb_page_embeddings.embedding vector(1024)`
 * (миграция 072/160) — смена модели на другую размерность потребует
 * ALTER COLUMN + полный re-embed. Ключ `embedM3` сохранён, чтобы не
 * трогать вызовы в embeddings.ts / ai-rag.ts. */
export const SILICONFLOW_MODELS = {
  embedM3: "Qwen/Qwen3-Embedding-0.6B",
} as const;

export const EMBEDDING_DIM = 1024;

/** Создаёт embedding(ов) для одной или нескольких строк.
 *  bge-m3 обрабатывает batch'и до 32 input'ов за раз — мы не лимитим
 *  здесь, но caller должен chunked-вызывать на больших массивах. */
export async function embedTexts(
  texts: string[],
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = getSiliconflowClient();
  const response = await client.embeddings.create({
    model: SILICONFLOW_MODELS.embedM3,
    input: texts,
  });
  // OpenAI SDK возвращает .data[i].embedding как number[].
  return response.data.map((d) => d.embedding as unknown as number[]);
}
