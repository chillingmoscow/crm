import {
  ArrowRight,
  Heading,
  Languages,
  RefreshCw,
  Scissors,
  SpellCheck,
  type LucideIcon,
} from "lucide-react";

import type { KbAiCommand } from "./ai-commands";

/**
 * UI-спецификации AI-команд (единый источник правды для всех мест, где они
 * показываются: десктопная FormattingToolbar-кнопка и мобильный бар).
 *
 * Серверная часть (промпты, вызов модели) — в `ai-commands.ts` (`runKbAiCommand`).
 * Здесь — только то, что нужно клиенту: метка, описание, иконка и режим вставки.
 */

export type AiInsertMode = "replace" | "after" | "heading";

export interface KbAiCommandSpec {
  id: KbAiCommand;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Куда положить ответ модели:
   *    replace — заменить выделение (требует selection)
   *    after   — вставить параграф после текущего блока
   *    heading — вставить H2 перед текущим блоком */
  mode: AiInsertMode;
}

export const KB_AI_COMMAND_SPECS: KbAiCommandSpec[] = [
  {
    id: "continue_writing",
    label: "Продолжить",
    description: "Дописать продолжение блока",
    icon: ArrowRight,
    mode: "after",
  },
  {
    id: "generate_heading",
    label: "Сгенерировать заголовок",
    description: "H2 над текущим блоком",
    icon: Heading,
    mode: "heading",
  },
  {
    id: "shorten",
    label: "Сократить",
    description: "Сжать в 2-3 раза, сохранить смысл",
    icon: Scissors,
    mode: "replace",
  },
  {
    id: "rephrase",
    label: "Переформулировать",
    description: "Тот же смысл, другие слова",
    icon: RefreshCw,
    mode: "replace",
  },
  {
    id: "fix_typos",
    label: "Исправить опечатки",
    description: "Орфография и пунктуация",
    icon: SpellCheck,
    mode: "replace",
  },
  {
    id: "translate_en",
    label: "Перевести на английский",
    description: "RU → EN",
    icon: Languages,
    mode: "replace",
  },
  {
    id: "translate_ru",
    label: "Перевести на русский",
    description: "EN → RU",
    icon: Languages,
    mode: "replace",
  },
];

/** Типы блоков, для которых AI-команды не имеют смысла. Все они существуют в
 *  дефолтной BlockNote-схеме; `image|video|audio|file` не содержат текста,
 *  `codeBlock` пользователь правит руками, остальные — структурные. */
export const NON_TEXT_AI_BLOCK_TYPES = new Set([
  "image",
  "video",
  "audio",
  "file",
  "codeBlock",
  "table",
  "divider",
  "pageBreak",
  "gallery",
  "collection",
]);

/** Cheap извлечение plain-text из inline-content одного блока — для блочных
 *  команд, которые работают по тексту блока без явного выделения. */
export function blockToPlainText(block: unknown): string {
  const b = block as { content?: unknown };
  if (!Array.isArray(b.content)) return "";
  const parts: string[] = [];
  for (const item of b.content as Array<{ type?: string; text?: string }>) {
    if (item.type === "text" && typeof item.text === "string") {
      parts.push(item.text);
    }
  }
  return parts.join("").trim();
}

/**
 * Определяет исходный текст для AI-команды по текущему состоянию редактора.
 * `replace`-команды требуют выделение; блочные (`after`/`heading`) работают по
 * выделению ИЛИ по тексту текущего блока. Возвращает текст либо причину отказа.
 */
export function resolveAiSourceText(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any,
  spec: KbAiCommandSpec,
): { text: string | null; error: string | null } {
  const selected = (editor.getSelectedText?.() ?? "").trim();
  if (spec.mode === "replace") {
    if (!selected) {
      return { text: null, error: "Выделите текст для AI-команды" };
    }
    return { text: selected, error: null };
  }
  const blockText = blockToPlainText(editor.getTextCursorPosition?.()?.block);
  const src = selected || blockText;
  if (!src) {
    return { text: null, error: "Текущий блок пустой — нечего обрабатывать" };
  }
  return { text: src, error: null };
}

/**
 * Вставляет результат AI-команды в редактор по режиму spec.mode. Блок для
 * `after`/`heading` берём заново на момент вставки (selection переживает blur
 * в наш мобильный лист, поэтому getTextCursorPosition остаётся валидным).
 */
export function applyAiResultToEditor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any,
  spec: KbAiCommandSpec,
  result: string,
): void {
  if (spec.mode === "replace") {
    editor.insertInlineContent(result);
    return;
  }
  const block = editor.getTextCursorPosition?.()?.block;
  if (!block) return;
  if (spec.mode === "after") {
    editor.insertBlocks(
      [{ type: "paragraph", content: result }],
      block,
      "after",
    );
  } else {
    editor.insertBlocks(
      [{ type: "heading", props: { level: 2 }, content: result }],
      block,
      "before",
    );
  }
}
