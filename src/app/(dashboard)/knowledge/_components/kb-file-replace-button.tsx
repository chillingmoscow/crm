"use client";

import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { useBlockNoteEditor, useEditorState } from "@blocknote/react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { KbFilePanel } from "@/app/(dashboard)/knowledge/_components/kb-file-panel";

/**
 * Кастомная замена BN-овского `FileReplaceButton`. Дефолтная кнопка
 * рендерит свой Popover с BN-default'ным `<FilePanel>` (нативный
 * `<input type="file">`-кнопка + URL-input), который НЕ подхватывает
 * наш `<FilePanelController filePanel={KbFilePanel}>` — controller
 * перехватывает только initial-add-block flow, а replace-button BN
 * рендерит панель напрямую через свой Popover.
 *
 * Эта обёртка использует тот же KbFilePanel что и initial-add: drop-
 * zone + URL-tab под дизайн sheerly.pen frame 13b · rNEwo. Юзер
 * видит идентичный UI при добавлении и при замене.
 *
 * Подменяется в `getFormattingToolbarItems(...)` через `key === "replaceFileButton"`.
 */
export function KbFileReplaceButton() {
  const editor = useBlockNoteEditor();
  const [open, setOpen] = useState(false);

  // Подписка на selection: рендерим кнопку только если выбран один
  // file-shape блок (тип с `url`-prop'ом). Это — поведение BN-овского
  // FileReplaceButton: он `null`'ит для не-file-блоков.
  const block = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      const sel = ed.getSelection();
      const blocks = sel?.blocks ?? [ed.getTextCursorPosition().block];
      if (blocks.length !== 1) return null;
      const b = blocks[0] as { id: string; type: string; props?: { url?: unknown } };
      // Проверка наличия `url`-prop'а — все file-shape блоки (image,
      // video, audio, file) его имеют. Не-file-блоки (paragraph,
      // heading и т.п.) — нет.
      if (!b?.props || typeof b.props.url !== "string") return null;
      return b;
    },
  });

  if (!block) return null;

  const tooltip = TOOLTIP[block.type] ?? TOOLTIP.file;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* shadcn `Button variant=ghost size=default` — тот же компонент,
            который BN-shadcn применяет к link/comment/AI кнопкам через
            FormattingToolbar.Button (см. kb-ai-formatting-button.tsx).
            Без него raw-button визуально на 6-8px меньше остальных
            кнопок ряда — выбивается из toolbar'а. */}
        <Button
          type="button"
          variant="ghost"
          size="default"
          aria-label={tooltip}
          title={tooltip}
          // mousedown.preventDefault — иначе клик стирает selection в
          // редакторе и block из selector'а становится null до того,
          // как успеет открыться popover (race с focus-loss'ом).
          onMouseDown={(e) => e.preventDefault()}
        >
          <ImagePlus className="size-4" strokeWidth={1.75} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="p-0 border-none bg-transparent shadow-none w-auto"
      >
        <KbFilePanel blockId={block.id} />
      </PopoverContent>
    </Popover>
  );
}

const TOOLTIP: Record<string, string> = {
  video: "Заменить видео",
  image: "Заменить изображение",
  audio: "Заменить аудио",
  file: "Заменить файл",
};
