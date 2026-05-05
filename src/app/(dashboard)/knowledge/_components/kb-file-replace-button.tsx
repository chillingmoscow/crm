"use client";

import { useState, type ReactNode } from "react";
import { File, Film, Music4, PaintbrushVertical } from "lucide-react";
import {
  useBlockNoteEditor,
  useComponentsContext,
  useEditorState,
} from "@blocknote/react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { KbFilePanel } from "@/app/(dashboard)/knowledge/_components/kb-file-panel";

/**
 * Кастомная замена BN-овского `FileReplaceButton`. Дефолтная кнопка
 * рендерит свой Popover с BN-default'ным `<FilePanel>` (нативный
 * `<input type="file">`-кнопка + URL-input), который НЕ подхватывает
 * наш `<FilePanelController filePanel={KbFilePanel}>` — controller
 * перехватывает только initial-add-block flow, а replace-button BN
 * рендерит панель напрямую через свой Popover.
 *
 * Используем Components.FormattingToolbar.Button (через
 * useComponentsContext) вместо нашего shadcn `<Button>` — гарантирует
 * совпадение геометрии с соседними BN-кнопками (alignment / nest /
 * link / etc.) и общий TooltipProvider'ом для красивых tooltip'ов
 * вместо native-title.
 *
 * Подменяется в `getFormattingToolbarItems(...)` через `key === "replaceFileButton"`.
 */
export function KbFileReplaceButton() {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext();
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

  if (!Components || !block) return null;

  const tooltip = TOOLTIP[block.type] ?? TOOLTIP.file;
  const icon = ICON_BY_TYPE[block.type] ?? ICON_BY_TYPE.file;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Components.FormattingToolbar.Button
          mainTooltip={tooltip}
          label={tooltip}
          icon={icon}
          onClick={() => setOpen((v) => !v)}
        />
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

// Type-specific replace-иконки. Юзер просил differentiate замену
// по типу медиа: для видео — film-strip (раскадровка), для
// изображения — кисть (paintbrush-vertical), для аудио — нота
// (music-4), для файла — page (file). Раньше ImagePlus был для всех
// → визуально неинформативно.
const ICON_BY_TYPE: Record<string, ReactNode> = {
  video: <Film className="size-4" strokeWidth={1.75} />,
  image: <PaintbrushVertical className="size-4" strokeWidth={1.75} />,
  audio: <Music4 className="size-4" strokeWidth={1.75} />,
  file: <File className="size-4" strokeWidth={1.75} />,
};
