"use client";

import { useReducer, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useBlockNoteEditor,
  useEditorSelectionChange,
} from "@blocknote/react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  runKbAiCommand,
  type KbAiCommand,
} from "@/lib/knowledge/ai-commands";
import {
  KB_AI_COMMAND_SPECS as COMMANDS,
  NON_TEXT_AI_BLOCK_TYPES as NON_TEXT_BLOCK_TYPES,
  blockToPlainText,
  type KbAiCommandSpec,
} from "@/lib/knowledge/ai-command-specs";

/**
 * AI-кнопка в FormattingToolbar BlockNote'а. Все AI-команды собраны
 * сюда, slash-меню больше их не показывает: для команд по выделению
 * `/` сбрасывал бы selection (см. предыдущий fix), а для блочных
 * команд (Продолжить / Сгенерировать заголовок) пользователю было
 * непонятно, чем slash-айтемы отличаются от других.
 *
 * Команды:
 *   - Продолжить — дописать продолжение текущего блока (after)
 *   - Сгенерировать заголовок — H2 над текущим блоком (heading)
 *   - Сократить — заменить выделение в 2-3 раза короче
 *   - Переформулировать
 *   - Исправить опечатки
 *   - Перевести на английский / русский
 *
 * Гейтинг по двум осям:
 *   - aiEnabled (kb.use_ai + accounts.ai_enabled, проверено сервер-сайдом)
 *   - block-type: для media-блоков (image/video/audio/file) AI бессмысленен
 *     — кнопка не рендерится, чтобы не засорять image-toolbar.
 *
 * Спецификации команд (метка/иконка/режим вставки) и хелперы — в общем модуле
 * `ai-command-specs.ts` (тот же источник использует мобильный бар).
 */

export function KbAiFormattingButton({ aiEnabled }: { aiEnabled: boolean }) {
  // useBlockNoteEditor — текущий editor instance из BlockNote-React-context.
  // Безопасно вызывать только внутри BlockNoteView/FormattingToolbar.
  const editor = useBlockNoteEditor();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<KbAiCommand | null>(null);

  // Принудительный re-render по каждому selection-change, чтобы
  // блочный gate ниже (NON_TEXT_BLOCK_TYPES) переоценивался при
  // переходе курсора между блоками. Без этого кнопка могла застрять
  // видимой над media-блоком, если до того стояли в параграфе.
  const [, forceTick] = useReducer((x: number) => x + 1, 0);
  useEditorSelectionChange(forceTick, editor);

  if (!aiEnabled) return null;

  // Если курсор стоит на не-текстовом блоке (image / video / file и т.п.),
  // AI-команды бесполезны — прячем кнопку, чтобы не засорять image-toolbar.
  const cursor = editor.getTextCursorPosition();
  if (!cursor || NON_TEXT_BLOCK_TYPES.has(cursor.block.type)) return null;

  const onPick = async (cmd: KbAiCommandSpec) => {
    const selected = editor.getSelectedText().trim();
    const blockText = blockToPlainText(cursor.block);

    let sourceText = "";
    if (cmd.mode === "replace") {
      // selection-команды требуют выделение
      sourceText = selected;
      if (!sourceText) {
        toast.info("Выделите текст для AI-команды");
        setOpen(false);
        return;
      }
    } else {
      // блочные команды работают по контексту блока (selection — приоритет)
      sourceText = selected || blockText;
      if (!sourceText) {
        toast.info("Текущий блок пустой — нечего обрабатывать");
        setOpen(false);
        return;
      }
    }

    setPending(cmd.id);
    const { result, error } = await runKbAiCommand({
      command: cmd.id,
      text: sourceText,
    });
    setPending(null);

    if (error || !result) {
      toast.error(`AI: ${error ?? "пустой ответ"}`);
      return;
    }

    switch (cmd.mode) {
      case "replace":
        // insertInlineContent заменит выделение результатом.
        editor.insertInlineContent(result);
        break;
      case "after":
        editor.insertBlocks(
          [{ type: "paragraph", content: result } as never],
          cursor.block,
          "after",
        );
        break;
      case "heading":
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
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Используем shadcn `Button variant=ghost size=default` — тот же
            компонент с теми же размерами, что BlockNote применяет к
            link/comment/etc через FormattingToolbar.Button (см.
            blocknote-shadcn dist line 824, Button.Button с variant=ghost
            size=default). Раньше у нас было `h-7 w-7` raw-button — оно
            визуально меньше BN-кнопок, и AI оказывалась на 6-8px выше
            ряда. */}
        <Button
          type="button"
          variant="ghost"
          size="default"
          aria-label="AI-команды"
          data-tip="ИИ"
          disabled={!!pending}
        >
          {pending ? (
            <Loader2 className="animate-spin text-brand" />
          ) : (
            <Sparkles className="text-brand" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[280px] p-1"
        align="start"
        sideOffset={6}
      >
        <ul className="flex flex-col gap-0.5">
          {COMMANDS.map((cmd) => (
            <li key={cmd.id}>
              <button
                type="button"
                onClick={() => void onPick(cmd)}
                disabled={!!pending}
                className="flex w-full items-start gap-2.5 rounded-md p-2 text-left
                           hover:bg-accent disabled:opacity-50"
              >
                <span className="mt-0.5 shrink-0">
                  <cmd.icon className="size-4 text-brand" />
                </span>
                <span className="flex-1 flex flex-col min-w-0">
                  <span className="text-sm font-medium text-foreground">
                    {cmd.label}
                  </span>
                  <span className="text-[12px] text-muted-foreground truncate">
                    {cmd.description}
                  </span>
                </span>
                {pending === cmd.id && (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                )}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
