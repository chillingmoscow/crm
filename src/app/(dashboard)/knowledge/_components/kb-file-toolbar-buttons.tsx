"use client";

import { useEffect, useRef, useState } from "react";
import {
  ClipboardType,
  Download,
  ExternalLink,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  useBlockNoteEditor,
  useComponentsContext,
  useEditorState,
} from "@blocknote/react";

import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { detectVideoEmbed } from "@/components/knowledge/blocks/kb-video-block";
import { joinFileName, splitFileName } from "@/lib/knowledge/file-name";

/**
 * Кастомные замены BN-овских FormattingToolbar-кнопок для file-shape
 * блоков (image / video / audio / file). Сохраняем поведение, но:
 *   • используем lucide-иконки вместо react-icons (Ri*)
 *   • рендерим триггер через `Components.FormattingToolbar.Button`,
 *     чтобы геометрия (h-10 ghost, padding) совпадала с соседними
 *     BN-кнопками (alignment / nest / link / etc.) и был общий
 *     TooltipProvider — без этого native-title с системной задержкой
 *     показывался вместо красивого tooltip'а в стиле DS.
 *
 * Подключаются через `swapFileToolbarButtons(items)` в blocknote-
 * editor.tsx: проходим items[], по item.key подменяем default React-
 * elements на наши.
 *
 * Caption и Rename — Popover с `<Input>`-полем. Раньше пробовали
 * inline-редактирование DOM-элемента (.bn-file-caption / .kb-media-
 * chip__label с setAttribute contenteditable=true), но это оказалось
 * хрупким: BN-овская React-перерисовка блока на изменение selection
 * затирала наш contentEditable, кнопка тулбара забирала focus, и в
 * empty-state caret вообще не появлялся. Popover с явным <Input>'ом —
 * предсказуемо и работает во всех four block-types.
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

/** Generic popover-form для prop-edit'а блока (caption / name).
 *  Открывается на клик кнопки тулбара, autoFocus'ит Input, на Enter /
 *  blur вызывает updateBlock и закрывается. */
function PropEditPopover({
  open,
  onOpenChange,
  trigger,
  initialValue,
  placeholder,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  trigger: React.ReactNode;
  initialValue: string;
  placeholder: string;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync initial value на каждое открытие — иначе после save/close
  // popover «помнит» предыдущий черновик.
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const submit = () => {
    onSubmit(value.trim());
    onOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-72 p-2"
        // autoFocus на Input'е делается через ref в useEffect, но Radix
        // Popover при открытии перехватывает focus в свой content. Без
        // onOpenAutoFocus={focus on input} он landing'ится на content
        // wrapper'е. Делегируем focus сразу на input.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
          inputRef.current?.select();
        }}
      >
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onOpenChange(false);
            }
          }}
          placeholder={placeholder}
          className="h-9"
        />
      </PopoverContent>
    </Popover>
  );
}

// ── Caption ────────────────────────────────────────────────────────

export function KbFileCaptionButton() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useBlockNoteEditor<any, any, any>();
  const Components = useComponentsContext();
  const block = useSelectedFileBlock();
  const [open, setOpen] = useState(false);

  if (!Components || !block) return null;

  const caption =
    typeof block.props?.caption === "string" ? block.props.caption : "";

  return (
    <PropEditPopover
      open={open}
      onOpenChange={setOpen}
      initialValue={caption}
      placeholder="Подпись к файлу"
      onSubmit={(value) => {
        editor.updateBlock(block.id, { props: { caption: value } });
      }}
      trigger={
        <Components.FormattingToolbar.Button
          mainTooltip="Добавить подпись"
          label="Добавить подпись"
          icon={<Pencil className="size-4" strokeWidth={1.75} />}
          onClick={() => setOpen((v) => !v)}
        />
      }
    />
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
  // Rename только для type="file": для image/video/audio имя — либо URL
  // (embed), либо filename загруженного blob'а, который юзер не должен
  // править вручную (имя должно совпадать с .Content-Disposition при
  // download'е). Caption — отдельная сущность, она остаётся для всех.
  if (block.type !== "file") return null;

  const name = typeof block.props?.name === "string" ? block.props.name : "";
  const { basename, extension } = splitFileName(name);

  return (
    <PropEditPopover
      open={open}
      onOpenChange={setOpen}
      // Юзер-фидбек на PR #153: «Переименовал PDF файл в "Преза.docx" —
      // в расширении теперь тоже указано docx». Реальное расширение
      // соответствует blob'у на Supabase storage и не должно меняться
      // через rename. Поэтому в input редактируется ТОЛЬКО basename;
      // extension всегда сохраняется и подставляется обратно.
      initialValue={basename}
      placeholder="Имя файла"
      onSubmit={(value) => {
        // Не переписываем имя пустой строкой — иначе chip остаётся без
        // label'а вообще. Если юзер очистил input — игнорируем save.
        if (!value) return;
        // joinFileName: возвращает basename + extension; защита от
        // дубля если юзер всё-таки скопипастил расширение в input.
        editor.updateBlock(block.id, {
          props: { name: joinFileName(value, extension) },
        });
      }}
      trigger={
        <Components.FormattingToolbar.Button
          mainTooltip="Переименовать"
          label="Переименовать"
          icon={<ClipboardType className="size-4" strokeWidth={1.75} />}
          onClick={() => setOpen((v) => !v)}
        />
      }
    />
  );
}

// ── Delete ─────────────────────────────────────────────────────────

export function KbFileDeleteButton() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useBlockNoteEditor<any, any, any>();
  const Components = useComponentsContext();
  const block = useSelectedFileBlock();

  if (!Components || !block) return null;

  return (
    <Components.FormattingToolbar.Button
      mainTooltip="Удалить"
      label="Удалить"
      icon={<Trash2 className="size-4" strokeWidth={1.75} />}
      onClick={() => {
        editor.focus();
        editor.removeBlocks([block.id]);
      }}
    />
  );
}

// ── Download / Open in browser / Show original ────────────────────

/** Возвращает true если URL — это embed-провайдер (YouTube / Vimeo /
 *  Loom / Vidyard) ИЛИ external https:// (т.е. не наш kbfile://). Для
 *  таких URL'ов download-anchor не работает (cross-origin без CORS),
 *  поэтому кнопку рендерим как «Открыть в браузере» с external-link-
 *  иконкой. Для kbfile:// (uploaded) — нормальный download. */
function isExternalUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("kbfile://")) return false;
  if (detectVideoEmbed(url)) return true;
  return /^https?:\/\//.test(url);
}

export function KbFileDownloadButton() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useBlockNoteEditor<any, any, any>();
  const Components = useComponentsContext();
  const block = useSelectedFileBlock();

  if (!Components || !block) return null;
  // Audio плеер уже даёт нативный download через свои controls (overflow
  // menu в `<audio controls>`), наша кнопка дублирует и сбивает с толку.
  if (block.type === "audio") return null;
  const url = typeof block.props?.url === "string" ? block.props.url : "";
  if (!url) return null;

  // Для image-блоков всегда показываем «Показать оригинал» (открывает
  // изображение в новой вкладке) — независимо от kbfile:// vs external.
  // Это юзер-friendly: уменьшенное превью inline в editor'е, а
  // оригинал открывается «как есть» в новой вкладке.
  const isImage = block.type === "image";
  const external = isExternalUrl(url);
  const label = isImage
    ? "Показать оригинал"
    : external
      ? "Открыть в браузере"
      : "Скачать";
  const icon =
    isImage || external ? (
      <ExternalLink className="size-4" strokeWidth={1.75} />
    ) : (
      <Download className="size-4" strokeWidth={1.75} />
    );

  const handleClick = () => {
    // Codex P1 на PR #141: window.open ПОСЛЕ await editor.resolveFileUrl
    // теряет user-activation context, и popup-blocker'ы Chrome / Safari
    // режут tab. Решение: открываем blank-tab СИНХРОННО внутри click-
    // handler'а (user-gesture ещё активен), затем navigate'им его на
    // resolved URL когда async-resolve завершится.
    const newTab = window.open("", "_blank");
    if (!newTab) return; // popup-blocker сработал даже на blank
    try {
      newTab.opener = null;
    } catch {
      // Cross-origin write блокируется — оставляем как есть.
    }

    void (async () => {
      let resolvedUrl: string;
      try {
        resolvedUrl = editor.resolveFileUrl
          ? await editor.resolveFileUrl(url)
          : url;
      } catch {
        if (!url.startsWith("kbfile://")) {
          resolvedUrl = url;
        } else {
          newTab.close();
          return;
        }
      }
      try {
        newTab.location.href = resolvedUrl;
      } catch {
        // Tab уже закрыт юзером / cross-origin восстание — silently.
      }
    })();
  };

  return (
    <Components.FormattingToolbar.Button
      mainTooltip={label}
      label={label}
      icon={icon}
      onClick={handleClick}
    />
  );
}

// Preview toggle снят по фидбеку юзера: media (image/video/audio)
// должны быть всегда в preview-режиме, без UI-toggle'а chip ↔ inline.
// Legacy-блоки с `showPreview=false` всё ещё рендерятся как chip
// (см. KbVideoBlock / KbAudioBlock / KbImageBlock — обратная
// совместимость), но новые user-action toggle'и больше не доступны.
