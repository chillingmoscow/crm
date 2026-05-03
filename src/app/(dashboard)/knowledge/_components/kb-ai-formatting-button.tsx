"use client";

import { useState } from "react";
import {
  Sparkles,
  Scissors,
  RefreshCw,
  Languages,
  SpellCheck,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useBlockNoteEditor } from "@blocknote/react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  runKbAiCommand,
  type KbAiCommand,
} from "@/lib/knowledge/ai-commands";

/**
 * AI-кнопка для FormattingToolbar BlockNote-редактора.
 *
 * Появляется во встроенном formatting-bar'е, который BlockNote сам
 * показывает при выделении текста (рядом с Bold / Italic / etc).
 *
 * Это правильное место для AI-команд по выделению. Раньше они жили
 * в slash-меню, но это было сломанным UX: чтобы invoke'нуть `/ai-…`
 * на selection, юзеру нужно было набрать `/`, что **сбрасывает
 * выделение** → команда никогда не получала текст.
 *
 * Команды через popover (5 шт):
 *   - Сократить
 *   - Переформулировать
 *   - Исправить опечатки
 *   - Перевести на английский
 *   - Перевести на русский
 *
 * `continue_writing` и `generate_heading` остаются в slash-меню — они
 * работают по контексту блока, не по выделению.
 *
 * Гейтинг: рендерится только если `aiEnabled` (kb.use_ai +
 * accounts.ai_enabled, проверено на server-side).
 */

interface AiCmdSpec {
  id: KbAiCommand;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const COMMANDS: AiCmdSpec[] = [
  {
    id: "shorten",
    label: "Сократить",
    description: "Сжать в 2-3 раза, сохранить смысл",
    icon: <Scissors className="size-4 text-brand" />,
  },
  {
    id: "rephrase",
    label: "Переформулировать",
    description: "Тот же смысл, другие слова",
    icon: <RefreshCw className="size-4 text-brand" />,
  },
  {
    id: "fix_typos",
    label: "Исправить опечатки",
    description: "Орфография и пунктуация",
    icon: <SpellCheck className="size-4 text-brand" />,
  },
  {
    id: "translate_en",
    label: "Перевести на английский",
    description: "RU → EN",
    icon: <Languages className="size-4 text-brand" />,
  },
  {
    id: "translate_ru",
    label: "Перевести на русский",
    description: "EN → RU",
    icon: <Languages className="size-4 text-brand" />,
  },
];

export function KbAiFormattingButton({ aiEnabled }: { aiEnabled: boolean }) {
  // useBlockNoteEditor — возвращает текущий editor instance из
  // BlockNote-React-context. Безопасно вызывать только внутри
  // BlockNoteView/FormattingToolbar.
  const editor = useBlockNoteEditor();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<KbAiCommand | null>(null);

  if (!aiEnabled) return null;

  const onPick = async (cmd: AiCmdSpec) => {
    const text = editor.getSelectedText().trim();
    if (!text) {
      toast.info("Выделите текст для AI-команды");
      setOpen(false);
      return;
    }

    setPending(cmd.id);
    const { result, error } = await runKbAiCommand({
      command: cmd.id,
      text,
    });
    setPending(null);

    if (error || !result) {
      toast.error(`AI: ${error ?? "пустой ответ"}`);
      return;
    }

    // insertInlineContent заменит выделение результатом. Plain-text
    // → принимается напрямую, BlockNote обернёт в text-run.
    editor.insertInlineContent(result);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Стилистика повторяет mantine-toolbar BlockNote'а: square
            ~28px button, rounded, hover-bg. BlockNote'овская обёртка
            FormattingToolbar добавляет padding/spacing вокруг детей. */}
        <button
          type="button"
          aria-label="AI-команды над выделением"
          title="ИИ"
          disabled={!!pending}
          className="inline-flex items-center justify-center gap-1 h-7 px-1.5 rounded
                     text-foreground hover:bg-accent hover:text-accent-foreground
                     transition-colors disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin text-brand" />
          ) : (
            <Sparkles className="size-4 text-brand" />
          )}
          <span className="text-xs font-medium">ИИ</span>
        </button>
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
                <span className="mt-0.5 shrink-0">{cmd.icon}</span>
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
