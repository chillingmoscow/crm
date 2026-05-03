import "server-only";

import OpenAI from "openai";

/**
 * SiliconFlow client для embeddings (OpenAI-compatible API).
 *
 * SiliconFlow (api.siliconflow.cn) хостит широкий каталог open-source
 * моделей, в т.ч. embeddings. Используем `BAAI/bge-m3` —
 * multilingual (RU/EN/CN/...), 1024 dim, 8K context, лучший в классе
 * open-source embedding-модель на 2025.
 *
 * Зачем не OpenAI / Voyage:
 *   - Доступ из RU без VPN.
 *   - Цена: $0.01/1M tokens для bge-m3 — практически free tier.
 *   - bge-m3 OS-стандарт, можно при желании self-host'ить позже.
 *
 * ENV: SILICONFLOW_API_KEY (Coolify env var на проде).
 */

const SILICONFLOW_BASE_URL = "https://api.siliconflow.cn/v1";

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

/** Embedding-модели SiliconFlow.
 *
 *   bge-m3 — 1024 dim, multilingual, 8K input. Дефолт для RAG.
 *
 * Размерность зашита в схему `kb_page_embeddings.embedding vector(1024)`
 * (миграция 072) — смена модели потребует ALTER COLUMN. */
export const SILICONFLOW_MODELS = {
  embedM3: "BAAI/bge-m3",
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
