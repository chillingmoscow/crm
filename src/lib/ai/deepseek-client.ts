import "server-only";

import OpenAI from "openai";

/**
 * DeepSeek client (OpenAI-compatible API).
 *
 * DeepSeek host их API на endpoint'е, эквивалентном OpenAI'шному
 * /v1/chat/completions — поэтому используем тот же `openai` npm-пакет
 * с подменой baseURL и apiKey.
 *
 * Зачем DeepSeek (а не OpenAI / Anthropic):
 *   - Цена: deepseek-chat $0.14/1M input, $0.28/1M output —
 *     ~10× дешевле Claude Haiku 4.5, ~20× дешевле GPT-4o mini.
 *   - Доступность из RU: api.deepseek.com принимает запросы из
 *     российских ASN'ов; OpenAI/Anthropic блокируют по IP/billing.
 *   - Качество: deepseek-chat (V3) на уровне GPT-4o mini для editing-
 *     задач (rephrase / shorten / fix typos).
 *
 * ENV:
 *   DEEPSEEK_API_KEY — обязательный. В .env.local для dev'а, в Coolify
 *                      Environment Variables для prod'а.
 *
 * Throws при создании, если key не выставлен — fail-fast лучше чем
 * silent-skip с уходом запроса в /dev/null.
 */

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

let cachedClient: OpenAI | null = null;

export function getDeepseekClient(): OpenAI {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY не выставлен. Добавьте в .env.local (dev) или Coolify Env Variables (prod).",
    );
  }
  cachedClient = new OpenAI({
    apiKey,
    baseURL: DEEPSEEK_BASE_URL,
  });
  return cachedClient;
}

/** Модели DeepSeek, которые мы используем.
 *
 *   deepseek-chat       — V3 (general-purpose, наш дефолт для editing).
 *   deepseek-reasoner   — R1 (reasoning, дороже + медленнее, для будущего
 *                         «спросить базу знаний» возможно понадобится). */
export const DEEPSEEK_MODELS = {
  chat: "deepseek-chat",
  reasoner: "deepseek-reasoner",
} as const;
