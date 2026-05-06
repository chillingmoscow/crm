"use client";

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

import { detectVideoEmbed } from "@/components/knowledge/blocks/kb-video-block";

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
 * Caption и rename теперь редактируются inline (не через popover) —
 * клик на кнопку находит соответствующий DOM-элемент в редакторе,
 * делает его contentEditable, фокусирует и слушает blur для save'а
 * через editor.updateBlock. Юзер набирает прямо в той области, где
 * caption / filename отображаются.
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

/** Inline-edit для bn-class'ом помеченных DOM-элементов внутри блока
 *  (`.bn-file-caption`, `.bn-file-name`). Делает элемент contentEditable,
 *  ставит cursor в конец, слушает blur → updateBlock. На blur также
 *  снимает contentEditable.
 *
 *  Вместо popover'а с `<Input>`-ом — UX по фидбеку юзера: «не открывать
 *  дополнительное окно, а сместить курсор в область, где располагается
 *  сама подпись». */
function startInlineEdit(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any;
  blockId: string;
  selector: string;
  /** Ключ prop'а в блоке, куда писать новое значение (caption / name). */
  propKey: string;
}) {
  const editorView = opts.editor._tiptapEditor?.view;
  if (!editorView) return;
  const editorDom = editorView.dom as HTMLElement;

  // Находим блок: BN ставит `data-id="<block.id>"` на bn-block-content
  // (см. src/blocks/createReactBlockSpec.tsx, addOptions). Внутри —
  // целевой `.bn-file-caption` / `.bn-file-name`.
  const blockEl = editorDom.querySelector<HTMLElement>(
    `[data-id="${opts.blockId}"]`,
  );
  if (!blockEl) return;
  const target = blockEl.querySelector<HTMLElement>(opts.selector);
  if (!target) return;

  target.setAttribute("contenteditable", "true");
  target.dataset.kbInlineEdit = opts.propKey;
  target.style.cursor = "text";
  target.style.outline = "none";

  // Если caption / name пустой — Chrome/Safari НЕ показывают мигающий
  // caret в empty contenteditable-элементе (известный quirk). Вставляем
  // `<br>` placeholder: достаточно чтобы появилась text-line и каретка
  // отрисовалась. На blur cleanup() читает `textContent` (br не считается
  // символом), так что value корректно пустеет если юзер ничего не
  // напечатал.
  if (target.textContent === "" && target.childNodes.length === 0) {
    target.appendChild(document.createElement("br"));
  }

  // requestAnimationFrame: дать браузеру применить contenteditable + наш
  // CSS-стейт перед focus'ом. Без этого Chrome иногда фокусит элемент
  // ДО layout'а, и caret остаётся невидимым (placeholder ::before уже
  // скрыт по [contenteditable=true]-селектору, но box ещё нулевой).
  requestAnimationFrame(() => {
    target.focus();

    // Move caret в конец текста (а не в начало — чтобы юзер мог сразу
    // дописывать к существующему тексту).
    try {
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {
      // Selection API may fail в некоторых случаях (detached node) — fine.
    }
  });

  const cleanup = () => {
    const value = (target.textContent ?? "").trim();
    // Чистим `<br>`-placeholder который мог быть вставлен для caret-
    // visibility в empty-state. Используем textContent (НЕ innerHTML):
    // value — это юзер-controlled caption/name, и innerHTML парсил бы
    // `<img src=x onerror=...>` как HTML → DOM-XSS-сток (Codex P1 на
    // PR #147). textContent безопасно ставит plain-text-нод, br-
    // плейсхолдер автоматически удаляется. После updateBlock BN
    // перерендерит блок и :empty-плейсхолдер снова покажется на hover.
    target.textContent = value;
    target.removeAttribute("contenteditable");
    delete target.dataset.kbInlineEdit;
    target.style.cursor = "";
    target.style.outline = "";
    target.removeEventListener("blur", onBlur);
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("click", onClick);
    target.removeEventListener("mousedown", onMouseDown);
    opts.editor.updateBlock(opts.blockId, { props: { [opts.propKey]: value } });
  };

  const onBlur = () => cleanup();

  const onKeyDown = (e: KeyboardEvent) => {
    // Stop propagation чтобы PM не пытался обработать keystroke как
    // edit'ы основного doc'а — мы редактируем prop, не PM-content.
    e.stopPropagation();
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      target.blur();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      target.blur();
    }
  };

  // Codex P2 на PR #143: для file-блока `.kb-media-chip__label` сидит
  // ВНУТРИ chip'а, у которого есть onClick → открывает файл в новой
  // вкладке. Без stopPropagation на target клик мышью для позиционирования
  // курсора bubble'ил до chip'а → file открывался → contentEditable
  // терял фокус → blur → cleanup → юзер не успевал ничего напечатать.
  // Останавливаем bubbling click + mousedown пока редактируем.
  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
  };
  const onMouseDown = (e: MouseEvent) => {
    e.stopPropagation();
  };

  target.addEventListener("blur", onBlur);
  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("click", onClick);
  target.addEventListener("mousedown", onMouseDown);
}

// ── Caption ────────────────────────────────────────────────────────

export function KbFileCaptionButton() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = useBlockNoteEditor<any, any, any>();
  const Components = useComponentsContext();
  const block = useSelectedFileBlock();

  if (!Components || !block) return null;

  return (
    <Components.FormattingToolbar.Button
      mainTooltip="Добавить подпись"
      label="Добавить подпись"
      icon={<Pencil className="size-4" strokeWidth={1.75} />}
      onClick={() =>
        startInlineEdit({
          editor,
          blockId: block.id,
          selector: ".bn-file-caption",
          propKey: "caption",
        })
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

  if (!Components || !block) return null;
  // Rename только для type="file": для image/video/audio имя — либо URL
  // (embed), либо filename загруженного blob'а, который юзер не должен
  // править вручную (имя должно совпадать с .Content-Disposition при
  // download'е). Caption — отдельная сущность, она остаётся для всех.
  if (block.type !== "file") return null;

  return (
    <Components.FormattingToolbar.Button
      mainTooltip="Переименовать"
      label="Переименовать"
      icon={<ClipboardType className="size-4" strokeWidth={1.75} />}
      onClick={() =>
        startInlineEdit({
          editor,
          blockId: block.id,
          // BN рендерит filename в `.bn-file-name` (см. ei в blocknote-
          // react.js — FileNameWithIcon). Для наших chip'ов
          // (KbMediaChip) — `.kb-media-chip__label`. Селектор-OR.
          selector: ".bn-file-name, .kb-media-chip__label",
          propKey: "name",
        })
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
