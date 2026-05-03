"use server";

import { createClient } from "@/lib/supabase/server";
import { getDeepseekClient, DEEPSEEK_MODELS } from "@/lib/ai/deepseek-client";

/** Поддерживаемые AI-команды.
 *
 *   shorten          — сократить выделенный текст
 *   rephrase         — переформулировать (сохранить смысл, поменять стиль)
 *   continue_writing — дописать продолжение
 *   translate_en     — перевести на английский
 *   translate_ru     — перевести на русский
 *   fix_typos        — исправить орфографию/пунктуацию
 *   generate_heading — сгенерировать заголовок для текста ниже
 *
 * Все команды возвращают **plain-text** (без markdown). Editor вставит
 * результат как inline-text или новый параграф.
 */
export type KbAiCommand =
  | "shorten"
  | "rephrase"
  | "continue_writing"
  | "translate_en"
  | "translate_ru"
  | "fix_typos"
  | "generate_heading";

const SYSTEM_PROMPT =
  "Ты помощник в редакторе KB-системы для ресторана. Отвечай только " +
  "содержимым, без markdown-форматирования и без вступительных фраз " +
  "вроде «Вот сокращённая версия:». Просто текст, готовый к вставке.";

const COMMAND_PROMPTS: Record<KbAiCommand, (text: string) => string> = {
  shorten: (text) =>
    `Сократи следующий текст в 2-3 раза, сохранив ключевой смысл и тон. Если это инструкция, оставь все шаги — убери только лишние слова.\n\n---\n${text}`,
  rephrase: (text) =>
    `Переформулируй следующий текст другими словами, сохранив смысл и приблизительную длину. Используй естественный русский язык.\n\n---\n${text}`,
  continue_writing: (text) =>
    `Продолжи следующий текст в том же стиле и тоне. Напиши 2-4 предложения. Не повторяй уже сказанное.\n\n---\n${text}`,
  translate_en: (text) =>
    `Переведи следующий текст на английский язык. Сохрани форматирование (списки, абзацы).\n\n---\n${text}`,
  translate_ru: (text) =>
    `Переведи следующий текст на русский язык. Сохрани форматирование (списки, абзацы).\n\n---\n${text}`,
  fix_typos: (text) =>
    `Исправь орфографические и пунктуационные ошибки в следующем тексте. НЕ меняй стиль, формулировки или структуру — только опечатки и пунктуация.\n\n---\n${text}`,
  generate_heading: (text) =>
    `Придумай короткий и точный заголовок (2-6 слов) для следующего текста. Верни ТОЛЬКО заголовок, без кавычек.\n\n---\n${text}`,
};

const COMMAND_LABELS: Record<KbAiCommand, string> = {
  shorten: "Сократить",
  rephrase: "Переформулировать",
  continue_writing: "Продолжить",
  translate_en: "Перевести на английский",
  translate_ru: "Перевести на русский",
  fix_typos: "Исправить опечатки",
  generate_heading: "Сгенерировать заголовок",
};

export async function listKbAiCommands(): Promise<
  Array<{ id: KbAiCommand; label: string }>
> {
  return (Object.keys(COMMAND_LABELS) as KbAiCommand[]).map((id) => ({
    id,
    label: COMMAND_LABELS[id],
  }));
}

/**
 * Запускает AI-команду на тексте, возвращает plain-text результат.
 *
 * НЕ стримит (для MVP): server-action возвращает финальный текст,
 * клиент вставляет одной операцией. Streaming через Next.js Server
 * Actions требует ReadableStream + custom protocol — не самый чистый
 * UX (видны chunks по 5-10 символов из-за TCP buffering). Для editing-
 * команд (~100-300 output tokens, ~2-5 секунд) одношаговый response
 * достаточен; spinner на кнопке покрывает ожидание.
 *
 * Гейтинг (двойной):
 *   - account.ai_enabled = true (account-level kill-switch)
 *   - has_permission('kb.use_ai')
 */
export async function runKbAiCommand(input: {
  command: KbAiCommand;
  text: string;
}): Promise<{ result: string | null; error: string | null }> {
  const text = (input.text ?? "").trim();
  if (text.length === 0) {
    return { result: null, error: "Пустой текст для AI-команды" };
  }
  if (text.length > 8000) {
    // Защита от случайного «выделил всю страницу 50000 символов».
    // 8000 chars ≈ 2000 токенов — комфортный потолок для DeepSeek.
    return { result: null, error: "Текст слишком длинный (макс 8000 символов)" };
  }

  if (!COMMAND_PROMPTS[input.command]) {
    return { result: null, error: "Неизвестная AI-команда" };
  }

  const supabase = await createClient();

  // Permission check + account-level kill-switch.
  const [{ data: canUse }, { data: accountId }] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "kb.use_ai" }),
    supabase.rpc("get_active_account_id"),
  ]);
  if (!canUse) {
    return { result: null, error: "Нет права пользоваться AI-помощником" };
  }
  if (!accountId) {
    return { result: null, error: "Нет активного account" };
  }

  const { data: account, error: accErr } = await supabase
    .from("accounts")
    .select("ai_enabled")
    .eq("id", accountId as unknown as string)
    .maybeSingle();
  if (accErr) return { result: null, error: accErr.message };
  if (!account?.ai_enabled) {
    return { result: null, error: "AI отключён для этого аккаунта" };
  }

  // Запрос к DeepSeek.
  let client;
  try {
    client = getDeepseekClient();
  } catch (err) {
    return {
      result: null,
      error: err instanceof Error ? err.message : "DeepSeek client error",
    };
  }

  const prompt = COMMAND_PROMPTS[input.command](text);

  try {
    const response = await client.chat.completions.create({
      model: DEEPSEEK_MODELS.chat,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      // Editing-команды детерминированны по природе — низкая температура
      // даёт стабильные правки. Для continue_writing можно было бы
      // повыше (0.7), но для MVP единый параметр ок.
      temperature: 0.3,
      max_tokens: 1000,
    });

    const result = response.choices[0]?.message?.content?.trim() ?? "";
    if (!result) {
      return { result: null, error: "Пустой ответ от AI" };
    }
    return { result, error: null };
  } catch (err) {
    // OpenAI SDK выбрасывает APIError с .status / .message.
    const message =
      err instanceof Error ? err.message : "Неизвестная ошибка AI";
    return { result: null, error: `AI-запрос упал: ${message}` };
  }
}
