"use client";

import { useState } from "react";
import {
  Captions,
  Download,
  ExternalLink,
  Pencil,
  Trash2,
} from "lucide-react";
import { useBlockNoteEditor, useEditorState } from "@blocknote/react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Кастомные замены BN-овских FormattingToolbar-кнопок для file-shape
 * блоков (image / video / audio / file). Все 5 кнопок используют BN-
 * default react-icons (RiInputField / RiFontFamily / RiDeleteBin7Line /
 * RiDownload2Fill / RiExternalLinkFill), а у нас в DS — lucide. Ещё:
 * caption и rename рендерят BN'ный `Generic.Form.TextInput` внутри
 * popover'а — он стилизован под bn-shadcn (другой radius / padding /
 * focus-ring), не совпадает с нашим `<Input>`. Здесь подменяем оба
 * аспекта: lucide-иконки + shadcn Popover + Input.
 *
 * Подключаются через `swapFileToolbarButtons(items)` в blocknote-
 * editor.tsx: проходим items[], по item.key подменяем default React-
 * elements на наши.
 */

// ── Helpers ────────────────────────────────────────────────────────

interface FileBlockSelector {
  id: string;
  type: string;
  props?: {
    url?: unknown;
    caption?: unknown;
    name?: unknown;
  };
}

/** Возвращает выбранный file-shape блок (с `url`-prop'ом). null если
 *  selection пустой / multi-block / не file-shape. */
function useSelectedFileBlock(): FileBlockSelector | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useBlockNoteEditor<any, any, any>();
  return useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      const sel = ed.getSelection();
      const blocks = sel?.blocks ?? [ed.getTextCursorPosition().block];
      if (blocks.length !== 1) return null;
      const b = blocks[0] as FileBlockSelector;
      if (!b?.props || typeof b.props.url !== "string") return null;
      return b;
    },
  });
}

const TYPE_LABEL: Record<string, string> = {
  video: "видео",
  image: "изображение",
  audio: "аудио",
  file: "файл",
};

// ── Caption ────────────────────────────────────────────────────────

export function KbFileCaptionButton() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useBlockNoteEditor<any, any, any>();
  const block = useSelectedFileBlock();
  const [open, setOpen] = useState(false);

  if (!block) return null;
  const caption = typeof block.props?.caption === "string" ? block.props.caption : "";

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    editor.updateBlock(block.id, { props: { caption: e.target.value } });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="default"
          aria-label="Подпись"
          title="Подпись"
          onMouseDown={(e) => e.preventDefault()}
        >
          <Captions className="size-4" strokeWidth={1.75} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-72 p-2"
      >
        <Input
          autoFocus
          value={caption}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder="Подпись к файлу"
          className="h-9"
        />
      </PopoverContent>
    </Popover>
  );
}

// ── Rename ─────────────────────────────────────────────────────────

export function KbFileRenameButton() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useBlockNoteEditor<any, any, any>();
  const block = useSelectedFileBlock();
  const [open, setOpen] = useState(false);

  if (!block) return null;
  // `name` присутствует в схемах image/video/audio/file и редактируется
  // только если selection-block имеет валидный prop. BN-rename-button
  // также фильтрует по этому условию (см. xn в blocknote-react.js).
  const name = typeof block.props?.name === "string" ? block.props.name : "";
  const label = `Переименовать ${TYPE_LABEL[block.type] ?? "файл"}`;

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    editor.updateBlock(block.id, { props: { name: e.target.value } });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="default"
          aria-label={label}
          title={label}
          onMouseDown={(e) => e.preventDefault()}
        >
          <Pencil className="size-4" strokeWidth={1.75} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-72 p-2"
      >
        <Input
          autoFocus
          value={name}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={label}
          className="h-9"
        />
      </PopoverContent>
    </Popover>
  );
}

// ── Delete ─────────────────────────────────────────────────────────

export function KbFileDeleteButton() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useBlockNoteEditor<any, any, any>();
  const block = useSelectedFileBlock();

  if (!block) return null;
  const label = `Удалить ${TYPE_LABEL[block.type] ?? "файл"}`;

  return (
    <Button
      type="button"
      variant="ghost"
      size="default"
      aria-label={label}
      title={label}
      onClick={() => {
        editor.focus();
        editor.removeBlocks([block.id]);
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <Trash2 className="size-4" strokeWidth={1.75} />
    </Button>
  );
}

// ── Download ───────────────────────────────────────────────────────

export function KbFileDownloadButton() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useBlockNoteEditor<any, any, any>();
  const block = useSelectedFileBlock();

  if (!block) return null;
  const url = typeof block.props?.url === "string" ? block.props.url : "";
  if (!url) return null;
  const label = `Скачать ${TYPE_LABEL[block.type] ?? "файл"}`;

  const handleClick = async () => {
    // Codex P1 на PR #130: previous version рендерила `<a href={url}
    // download>` напрямую. Для uploaded-файлов мы храним url'ы как
    // `kbfile://<storage_path>` (см. blocknote-editor.tsx) — это не
    // fetchable URL, browser молча игнорирует click. Resolve через
    // editor.resolveFileUrl (как делает BN-default FileDownloadButton)
    // конвертит в свежую signed-Supabase-URL'у. Для cross-origin'ов
    // (YouTube/Vimeo/external https://) resolveFileUrl no-op'ит и
    // возвращает оригинал.
    const resolved = editor.resolveFileUrl
      ? await editor.resolveFileUrl(url)
      : url;
    window.open(resolved, "_blank", "noopener,noreferrer");
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="default"
      aria-label={label}
      title={label}
      onClick={handleClick}
      onMouseDown={(e) => e.preventDefault()}
    >
      <Download className="size-4" strokeWidth={1.75} />
    </Button>
  );
}

// ── Preview (open in new tab / toggle preview) ─────────────────────

export function KbFilePreviewButton() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useBlockNoteEditor<any, any, any>();
  const block = useSelectedFileBlock();

  if (!block) return null;
  // BN'ный FilePreview-button toggle'ит showPreview prop у image/video/
  // audio (показывать inline `<img>`/`<video>` или ссылку chip'ом).
  // Кнопка появляется только у блоков с `showPreview` в propSchema —
  // тип `file` его не имеет, для него BN кнопку скрывает. Нашу логику
  // дублируем: если у блока нет prop'а — рендерим null.
  const showPreview = (block.props as { showPreview?: unknown } | undefined)
    ?.showPreview;
  if (typeof showPreview !== "boolean") return null;

  const label = showPreview ? "Скрыть превью" : "Показать превью";

  return (
    <Button
      type="button"
      variant="ghost"
      size="default"
      aria-label={label}
      title={label}
      onClick={() => {
        editor.updateBlock(block.id, {
          props: { showPreview: !showPreview },
        });
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <ExternalLink className="size-4" strokeWidth={1.75} />
    </Button>
  );
}
