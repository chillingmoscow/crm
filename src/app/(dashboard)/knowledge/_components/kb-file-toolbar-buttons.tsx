"use client";

import { useState } from "react";
import {
  ClipboardType,
  Download,
  ExternalLink,
  ImageMinus,
  ImagePlus,
  Pencil,
  Trash2,
} from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { detectVideoEmbed } from "@/components/knowledge/blocks/kb-video-block";

/**
 * Кастомные замены BN-овских FormattingToolbar-кнопок для file-shape
 * блоков (image / video / audio / file). Сохраняем поведение, но:
 *   • используем lucide-иконки вместо react-icons (Ri*)
 *   • рендерим триггер через `Components.FormattingToolbar.Button`,
 *     чтобы геометрия (h-10 ghost, padding) совпадала с соседними
 *     BN-кнопками (alignment / nest / link / etc.) и был общий
 *     TooltipProvider — без этого native-title с системной задержкой
 *     показывался вместо красивого tooltip'а в стиле DS
 *   • caption / rename popover'ы рендерим shadcn'ным `<Input>` вместо
 *     BN-овского `Generic.Form.TextInput` (другой radius / focus-ring).
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
    showPreview?: unknown;
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
  const Components = useComponentsContext();
  const block = useSelectedFileBlock();
  const [open, setOpen] = useState(false);

  if (!Components || !block) return null;
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
        <Components.FormattingToolbar.Button
          mainTooltip="Подпись"
          label="Подпись"
          icon={<Pencil className="size-4" strokeWidth={1.75} />}
          onClick={() => setOpen((v) => !v)}
        />
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
  const Components = useComponentsContext();
  const block = useSelectedFileBlock();
  const [open, setOpen] = useState(false);

  if (!Components || !block) return null;
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
        <Components.FormattingToolbar.Button
          mainTooltip={label}
          label={label}
          icon={<ClipboardType className="size-4" strokeWidth={1.75} />}
          onClick={() => setOpen((v) => !v)}
        />
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
  const Components = useComponentsContext();
  const block = useSelectedFileBlock();

  if (!Components || !block) return null;
  const label = `Удалить ${TYPE_LABEL[block.type] ?? "файл"}`;

  return (
    <Components.FormattingToolbar.Button
      mainTooltip={label}
      label={label}
      icon={<Trash2 className="size-4" strokeWidth={1.75} />}
      onClick={() => {
        editor.focus();
        editor.removeBlocks([block.id]);
      }}
    />
  );
}

// ── Download / Open in browser ─────────────────────────────────────

/** Возвращает true если URL — это embed-провайдер (YouTube / Vimeo /
 *  Loom / Vidyard) ИЛИ external https:// (т.е. не наш kbfile://). Для
 *  таких URL'ов download-anchor не работает (cross-origin без CORS),
 *  поэтому кнопку рендерим как «Открыть в браузере» с external-link-
 *  иконкой. Для kbfile:// (uploaded) — нормальный download. */
function isExternalUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("kbfile://")) return false;
  if (detectVideoEmbed(url)) return true;
  // Любой http(s):// — внешний (download-attribute не сработает
  // cross-origin без CORS-allow-Content-Disposition).
  return /^https?:\/\//.test(url);
}

export function KbFileDownloadButton() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useBlockNoteEditor<any, any, any>();
  const Components = useComponentsContext();
  const block = useSelectedFileBlock();

  if (!Components || !block) return null;
  const url = typeof block.props?.url === "string" ? block.props.url : "";
  if (!url) return null;
  const external = isExternalUrl(url);
  const label = external
    ? "Открыть в браузере"
    : `Скачать ${TYPE_LABEL[block.type] ?? "файл"}`;

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
    <Components.FormattingToolbar.Button
      mainTooltip={label}
      label={label}
      icon={
        external ? (
          <ExternalLink className="size-4" strokeWidth={1.75} />
        ) : (
          <Download className="size-4" strokeWidth={1.75} />
        )
      }
      onClick={handleClick}
    />
  );
}

// ── Preview toggle ─────────────────────────────────────────────────

export function KbFilePreviewButton() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useBlockNoteEditor<any, any, any>();
  const Components = useComponentsContext();
  const block = useSelectedFileBlock();

  if (!Components || !block) return null;
  // BN'ный FilePreview-button toggle'ит showPreview prop у image/video/
  // audio (показывать inline `<img>`/`<video>` или ссылку chip'ом).
  // Кнопка появляется только у блоков с `showPreview` в propSchema —
  // тип `file` его не имеет, для него BN кнопку скрывает. Дублируем
  // — если у блока нет prop'а, рендерим null.
  const showPreview = block.props?.showPreview;
  if (typeof showPreview !== "boolean") return null;

  const label = showPreview ? "Скрыть превью" : "Показать превью";

  return (
    <Components.FormattingToolbar.Button
      mainTooltip={label}
      label={label}
      icon={
        showPreview ? (
          <ImageMinus className="size-4" strokeWidth={1.75} />
        ) : (
          <ImagePlus className="size-4" strokeWidth={1.75} />
        )
      }
      onClick={() => {
        editor.updateBlock(block.id, {
          props: { showPreview: !showPreview },
        });
      }}
    />
  );
}
