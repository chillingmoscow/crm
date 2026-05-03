"use client";

import {
  Sparkles,
  Scissors,
  RefreshCw,
  ArrowRight,
  Languages,
  SpellCheck,
  Heading,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import type { BlockNoteEditor } from "@blocknote/core";

import {
  runKbAiCommand,
  type KbAiCommand,
} from "@/lib/knowledge/ai-commands";

/** Описание AI-команды для slash-меню. */
interface AiCommandSpec {
  /** Айтем-id для KbAiCommand server-action'а. */
  id: KbAiCommand;
  title: string;
  subtext: string;
  /** Lucide-иконка для menu-item'а. */
  icon: ReactNode;
  /** Aliases для search в slash-меню (русский + транслит + английский). */
  aliases: string[];
  /** Для команд, которые работают с **выделением**: empty selection
   *  → toast и no-op. Для команд, которые работают с пустым ввод
   *  тоже (continue/generate_heading из контекста-блока) — false. */
  requiresSelection: boolean;
  /** Replace mode:
   *    - "replace"  — заменить выделение результатом (или вставить
   *                    в курсор если ничего не выделено)
   *    - "after"    — вставить новый параграф после текущего блока
   *    - "heading"  — вставить как H2 ПЕРЕД текущим блоком */
  insertMode: "replace" | "after" | "heading";
}

const AI_COMMANDS: AiCommandSpec[] = [
  {
    id: "shorten",
    title: "Сократить",
    subtext: "ИИ сократит выделенный текст",
    icon: <Scissors className="size-4 text-brand" />,
    aliases: ["shorten", "short", "sokratit", "сократить"],
    requiresSelection: true,
    insertMode: "replace",
  },
  {
    id: "rephrase",
    title: "Переформулировать",
    subtext: "Тот же смысл, другие слова",
    icon: <RefreshCw className="size-4 text-brand" />,
    aliases: ["rephrase", "pereformulate", "perefraz", "переформулировать"],
    requiresSelection: true,
    insertMode: "replace",
  },
  {
    id: "fix_typos",
    title: "Исправить опечатки",
    subtext: "Орфография и пунктуация",
    icon: <SpellCheck className="size-4 text-brand" />,
    aliases: ["fix", "typos", "spell", "ispravit", "исправить"],
    requiresSelection: true,
    insertMode: "replace",
  },
  {
    id: "translate_en",
    title: "Перевести на английский",
    subtext: "Текст → English",
    icon: <Languages className="size-4 text-brand" />,
    aliases: ["translate", "english", "en", "perevod"],
    requiresSelection: true,
    insertMode: "replace",
  },
  {
    id: "translate_ru",
    title: "Перевести на русский",
    subtext: "English → Текст",
    icon: <Languages className="size-4 text-brand" />,
    aliases: ["translate", "russian", "ru"],
    requiresSelection: true,
    insertMode: "replace",
  },
  {
    id: "continue_writing",
    title: "Продолжить",
    subtext: "ИИ напишет продолжение текущего блока",
    icon: <ArrowRight className="size-4 text-brand" />,
    aliases: ["continue", "write", "prodolzhit", "продолжить"],
    requiresSelection: false,
    insertMode: "after",
  },
  {
    id: "generate_heading",
    title: "Сгенерировать заголовок",
    subtext: "Заголовок для текущего блока",
    icon: <Heading className="size-4 text-brand" />,
    aliases: ["heading", "title", "zagolovok", "заголовок"],
    requiresSelection: false,
    insertMode: "heading",
  },
];

/** Возвращает slash-menu items для AI-команд. Каждый item при клике:
 *  1. Берёт текст (selection ИЛИ текущий блок).
 *  2. Зовёт server-action runKbAiCommand.
 *  3. Вставляет результат согласно insertMode.
 *
 * Если editor.aiEnabled (из props) === false — возвращает пустой
 * массив (slash-меню просто не покажет AI-айтемов). */
export function getKbAiSlashItems(
  editor: BlockNoteEditor<never, never, never>,
  aiEnabled: boolean,
) {
  if (!aiEnabled) return [];

  return AI_COMMANDS.map((spec) => ({
    title: spec.title,
    subtext: spec.subtext,
    aliases: spec.aliases,
    group: "ИИ",
    icon: spec.icon,
    onItemClick: () => {
      void executeAiCommand(editor, spec);
    },
  }));
}

async function executeAiCommand(
  editor: BlockNoteEditor<never, never, never>,
  spec: AiCommandSpec,
): Promise<void> {
  const selected = editor.getSelectedText().trim();
  const cursor = editor.getTextCursorPosition();

  // Текст для AI: выделение или весь текст текущего блока.
  let sourceText = selected;
  if (!sourceText && !spec.requiresSelection) {
    // continue_writing / generate_heading работают по контексту блока
    // (даже если ничего не выделено).
    sourceText = blockToPlainText(cursor.block);
  }

  if (!sourceText) {
    toast.info(
      spec.requiresSelection
        ? "Выделите текст для AI-команды"
        : "Текущий блок пустой — нечего обрабатывать",
    );
    return;
  }

  const toastId = toast.loading(`${spec.title}…`);
  const { result, error } = await runKbAiCommand({
    command: spec.id,
    text: sourceText,
  });
  toast.dismiss(toastId);

  if (error || !result) {
    toast.error(`AI: ${error ?? "пустой ответ"}`);
    return;
  }

  // Вставка результата.
  switch (spec.insertMode) {
    case "replace":
      // insertInlineContent заменит выделение если оно есть, иначе
      // вставит в курсор. Plain-text → передаём как массив с одним
      // text-run'ом (BlockNote API).
      // Plain-text принимается напрямую — внутренне BlockNote
      // обернёт в text-run. Массив с {type:"text", text, styles}
      // ломал тип PartialInlineContent (styles ожидает StyleSchema).
      editor.insertInlineContent(result);
      break;
    case "after":
      // Вставляем новый параграф после текущего блока.
      editor.insertBlocks(
        [{ type: "paragraph", content: result } as never],
        cursor.block,
        "after",
      );
      break;
    case "heading":
      // Вставляем заголовок (H2) ПЕРЕД текущим блоком — UX «дай мне
      // заголовок над этим текстом».
      editor.insertBlocks(
        [
          {
            type: "heading",
            props: { level: 2 },
            content: result,
          } as never,
        ],
        cursor.block,
        "before",
      );
      break;
  }
}

/** Cheap извлечение plain-text из одного блока (для контекста
 *  continue_writing / generate_heading). Не walks children — только
 *  inline-content текущего блока. Если пустой — возвращает "".
 */
function blockToPlainText(block: unknown): string {
  const b = block as { content?: unknown };
  if (!Array.isArray(b.content)) return "";
  const out: string[] = [];
  for (const item of b.content as Array<{ type?: string; text?: string }>) {
    if (item.type === "text" && typeof item.text === "string") {
      out.push(item.text);
    }
  }
  return out.join("").trim();
}

/** Trigger-икона для slash-айтемов AI (используется как hint в FAB
 *  или иконка в group-header'е, если когда-нибудь вынесем UX). */
export const KbAiIcon = Sparkles;
