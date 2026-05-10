"use client";

import * as React from "react";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useTheme } from "next-themes";
import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from "@blocknote/core";
import { ru as ruLocale } from "@blocknote/core/locales";
import {
  SuggestionMenuController,
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  getFormattingToolbarItems,
  useCreateBlockNote,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import {
  CommentsExtension,
  type ThreadStore,
  type User as CommentUser,
} from "@blocknote/core/comments";
import {
  FilePanelController,
  FloatingComposerController,
  FloatingThreadController,
  LinkToolbar,
  LinkToolbarController,
} from "@blocknote/react";
import {
  Info,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Type,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Quote,
  List,
  ListOrdered,
  ListChecks,
  ListCollapse,
  FilePlus,
  Database,
  Smile,
  Images,
  type LucideIcon,
} from "lucide-react";
import {
  blockTypeSelectItems as defaultBlockTypeSelectItems,
  type BlockTypeSelectItem,
} from "@blocknote/react";

// react-icons IconType — `(props: IconBaseProps) => JSX.Element`. Не
// импортируем сам `react-icons` (transitive dep BN, не в нашем
// package.json), описываем минимально совместимо с BN's
// `BlockTypeSelectItem.icon` shape.
type IconType = ((props: {
  size?: number | string;
  className?: string;
  color?: string;
}) => React.ReactElement) & { displayName?: string };
import { cn } from "@/lib/utils";
import {
  htmlHasBrokenImg,
  stripBrokenImgInHtml,
} from "@/lib/knowledge/blocks-media";
import { kbCalloutBlock } from "@/components/knowledge/blocks/kb-callout-block";
import { kbQuoteBlock } from "@/components/knowledge/blocks/kb-quote-block";
import { kbVideoBlockSpec } from "@/components/knowledge/blocks/kb-video-block";
import { kbAudioBlockSpec } from "@/components/knowledge/blocks/kb-audio-block";
import { kbFileBlockSpec } from "@/components/knowledge/blocks/kb-file-block";
import { kbImageBlockSpec } from "@/components/knowledge/blocks/kb-image-block";
import { kbGalleryBlockSpec } from "@/components/knowledge/blocks/kb-gallery-block";
import {
  KbCollectionRuntimeProvider,
  kbCollectionBlockSpec,
} from "@/components/knowledge/blocks/kb-collection-block";
import { KbHeadingEnterExtension } from "@/components/knowledge/blocks/kb-heading-enter-extension";
import { kbPageMentionInlineContent } from "@/components/knowledge/blocks/kb-page-mention";
import { kbStaffMentionInlineContent } from "@/components/knowledge/blocks/kb-staff-mention";
import { KbFloatingComposer } from "@/components/knowledge/blocks/kb-floating-composer";
import { KbFloatingThread } from "@/components/knowledge/blocks/kb-floating-thread";
import {
  KbEmojiPickerOverlay,
  openKbEmojiPicker,
} from "@/components/knowledge/blocks/kb-emoji-picker";
import { KbAiFormattingButton } from "@/app/(dashboard)/knowledge/_components/kb-ai-formatting-button";
import { KbSlashMenu } from "@/app/(dashboard)/knowledge/_components/kb-slash-menu";
import { KbFilePanel } from "@/app/(dashboard)/knowledge/_components/kb-file-panel";
import { KbFileReplaceButton } from "@/app/(dashboard)/knowledge/_components/kb-file-replace-button";
import {
  KbFileCaptionButton,
  KbFileDeleteButton,
  KbFileDownloadButton,
  KbFileRenameButton,
} from "@/app/(dashboard)/knowledge/_components/kb-file-toolbar-buttons";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

import type { KbBlock } from "@/types/knowledge";
import { KB_GALLERY_EMPTY_JSON } from "@/lib/knowledge/gallery";
import {
  KB_COLLECTION_DEFAULT_VISIBLE_FIELDS,
  KB_COLLECTION_EMPTY_SCHEMA,
  createCollectionId,
  getPageCollectionId,
} from "@/lib/knowledge/collection";

/** Custom URL scheme used to mark uploaded KB files. The string after
 *  `kbfile://` is the storage_path inside `account-attachments`.
 *  resolveFileUrl swaps these for fresh signed URLs at render time —
 *  signed URLs themselves expire after ~1h and would break inline images
 *  if stored as-is in the BlockNote document.
 */
const KB_FILE_SCHEME = "kbfile://";

export type BlockNoteEditorProps = {
  /**
   * Initial document. `null` / `undefined` → BlockNote opens with an
   * empty paragraph. Pass the previously-saved `kb_pages.content` jsonb.
   */
  initialContent?: KbBlock[] | null;
  /** Current KB page id, used by collection-like custom blocks. */
  pageId?: string | null;
  /**
   * Read-only preview mode (e.g. version history snapshots).
   * Disables editing and hides the side menu / formatting toolbar.
   */
  editable?: boolean;
  /**
   * Fires on every editor change. Keep this callback cheap: callers
   * should debounce any full-document projections before hitting the
   * network.
   */
  onChange?: (args: { content: KbBlock[] }) => void;
  /**
   * Async upload handler. Receives the dropped/picked File, must
   * return a string that BlockNote stores in the block. We return
   * `kbfile://<storage_path>` so it round-trips losslessly through
   * the jsonb column; resolveFileUrl below swaps it for a fresh
   * signed URL on every render.
   */
  uploadFile?: (file: File) => Promise<string>;
  /**
   * Per-render URL transformer. Called with whatever URL was stored
   * in the block; returns the URL the browser should actually fetch.
   * For external URLs this is a no-op; for our `kbfile://` scheme it
   * mints a fresh signed URL.
   */
  resolveFileUrl?: (url: string) => Promise<string>;
  /**
   * Render-prop hook for extra controllers (suggestion menus, etc.)
   * that need the editor instance. Output is rendered as a child of
   * BlockNoteView, where BlockNote's React context provides the
   * editor to nested components.
   */
  renderExtras?: (editor: BlockNoteEditor) => ReactNode;
  /** Если передан кастомный SideMenuController через renderExtras —
   *  отключаем встроенный, чтобы не было двух одновременно. */
  customSideMenu?: boolean;
  /** Если true — отключаем дефолтный slash-menu и подставляем свой,
   *  расширенный custom-айтемами (callout-варианты и пр.). Дефолтные
   *  пункты при этом сохраняются — мы просто комбинируем. */
  customSlashMenu?: boolean;
  /** Если передан — в slash-меню в начало группы «Базовые блоки»
   *  добавляется пункт «Новая страница». Колбэк запускается при выборе
   *  и должен сам создать вложенную страницу + перевести юзера на неё.
   *  Хост (`KbPageEditor`) знает текущий pageId + имеет router. Если
   *  не передан (например, у юзера нет `kb.create_pages`) — пункт
   *  не показывается. */
  onCreateNestedPage?: () => void;
  /** Если true — добавляем AI-команды (`/ai*`) в slash-меню. Гейтится
   *  выше: `kb.use_ai` permission + `accounts.ai_enabled`. Server-action
   *  всё равно повторно проверит — это просто UX-слой. */
  aiSlashEnabled?: boolean;
  /** Если передан — подключает CommentsExtension с этим thread-store'ом.
   *  Активирует comment-mark в editor + AddCommentButton в
   *  formatting-toolbar + FloatingComposer/FloatingThread controllers.
   *  null/undefined — комментарии отключены (read-only страница ИЛИ нет
   *  kb.comment_pages). */
  commentsBundle?: CommentsBundle | null;
  className?: string;
};

/** Bundle, передаваемый из KbPageEditor в KbBlockNoteEditor чтобы
 *  CommentsExtension получил всё, что нужно. ThreadStore + resolver
 *  юзеров (для аватарок в comment-bubble) + флаг canComment (если
 *  false — отключаем AddCommentButton, но рендерим existing comments
 *  для просмотра). */
export interface CommentsBundle {
  threadStore: ThreadStore;
  resolveUsers: (userIds: string[]) => Promise<CommentUser[]>;
  canComment: boolean;
  /** Current user — для рендера аватарки + initials в кастомном
   *  floating-композере (Notion-style chip). null если не залогинен. */
  currentUserName: string | null;
  currentUserAvatarUrl: string | null;
}

export const KB_BLOCKNOTE_FILE_SCHEME = KB_FILE_SCHEME;

/** 4 slash-menu айтема для callout-вариантов. Группируются под
 *  «Подсказки», чтобы соседствовать в menu, а не раскидываться.
 *  Принимает editor wide-типа (any-shape), потому что наш schema
 *  расширен callout-блоком относительно дефолтного BlockNoteEditor. */
function getKbCalloutSlashItems(editor: BlockNoteEditor<never, never, never>) {
  // Используем helper, которым пользуются built-in slash-айтемы
  // (`@blocknote/core` экспортирует его напрямую). Он делает
  // updateBlock на текущем пустом параграфе и insertBlocks "after"
  // только если текущий блок непустой — без него `/` на пустой
  // строке оставлял бы исходный пустой параграф над callout'ом.
  const insert = (variant: "info" | "warning" | "success" | "error") => () => {
    insertOrUpdateBlockForSlashMenu(editor, {
      type: "callout",
      props: { variant },
    } as never);
  };
  return [
    {
      title: "Подсказка",
      subtext: "Информационный блок",
      aliases: ["info", "callout", "podskazka"],
      group: "Подсказки",
      icon: <Info className="size-4 text-brand" />,
      onItemClick: insert("info"),
    },
    {
      title: "Предупреждение",
      subtext: "Жёлтая плашка с восклицанием",
      aliases: ["warning", "warn", "preduprezhdenie"],
      group: "Подсказки",
      icon: <AlertTriangle className="size-4 text-yellow-700 dark:text-yellow-400" />,
      onItemClick: insert("warning"),
    },
    {
      title: "Успех",
      subtext: "Зелёная плашка-галочка",
      aliases: ["success", "ok", "uspeh"],
      group: "Подсказки",
      icon: <CheckCircle2 className="size-4 text-emerald-700 dark:text-emerald-400" />,
      onItemClick: insert("success"),
    },
    {
      title: "Ошибка",
      subtext: "Красная плашка-крестик",
      aliases: ["error", "danger", "oshibka"],
      group: "Подсказки",
      icon: <XCircle className="size-4 text-destructive" />,
      onItemClick: insert("error"),
    },
  ];
}

/** Slash-item «Новая страница» — первая позиция в группе «Базовые блоки».
 *  Хост создаёт kb_page и переходит на неё. Никаких изменений в content
 *  текущей страницы не делаем (BN сам затирает `/новая` префикс при
 *  выборе пункта); в худшем случае на исходной странице остаётся пустой
 *  параграф — это нормально для UX «команда исполнилась — навигация». */
function getKbNewPageSlashItem(onCreate: () => void) {
  return {
    title: "Новая страница",
    subtext: "Создать вложенную страницу и открыть её",
    aliases: ["page", "new", "novaya", "stranitsa", "новая", "страница"],
    group: "Базовые блоки",
    icon: <FilePlus className="size-4 text-brand" />,
    onItemClick: onCreate,
  };
}

/** Slash-item «Эмодзи» — открывает Notion-style emoji-picker overlay
 *  (kb-emoji-picker.tsx). После выбора эмодзи вставляется в текущий
 *  блок через editor.insertInlineContent. Picker — отдельный popover,
 *  не растягиваем slash-меню эмодзи-grid'ом (BN list flat и не
 *  поддерживает категории, поэтому для эмодзи рендерим свой UI). */
function getKbEmojiSlashItem(editor: BlockNoteEditor<never, never, never>) {
  return {
    title: "Эмодзи",
    subtext: "Вставить эмодзи в текст",
    aliases: ["emoji", "эмодзи", "smile", "смайл"],
    group: "Прочее",
    icon: <Smile className="size-4 text-brand" />,
    onItemClick: () => {
      // Координата каретки — берём bounding rect view'а на posBefore.
      // Если selection пуст или в неподходящем месте, fallback к centre
      // viewport'а (overlay сам clamp'нется).
      let anchor: { x: number; y: number } = {
        x: window.innerWidth / 2 - 180,
        y: window.innerHeight / 2 - 200,
      };
      try {
        const view = (
          editor as unknown as { prosemirrorView?: { coordsAtPos: (pos: number) => { left: number; top: number; bottom: number } } }
        ).prosemirrorView;
        const sel = (
          editor as unknown as { _tiptapEditor?: { state: { selection: { from: number } } } }
        )._tiptapEditor?.state.selection;
        if (view && sel) {
          const c = view.coordsAtPos(sel.from);
          anchor = { x: c.left, y: c.bottom };
        }
      } catch {
        /* ignore — fallback к центру viewport'а */
      }
      openKbEmojiPicker(editor as unknown as BlockNoteEditor, anchor);
    },
  };
}

function getKbGallerySlashItem(editor: BlockNoteEditor<never, never, never>) {
  return {
    title: "Галерея",
    subtext: "Сетка изображений с подписями",
    aliases: ["gallery", "grid", "галерея", "сетка", "фото", "изображения"],
    group: "Медиа",
    icon: <Images className="size-4 text-brand" />,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, {
        type: "gallery",
        props: {
          columns: 3,
          itemsJson: KB_GALLERY_EMPTY_JSON,
          layout: "spotlight",
          imageFit: "cover",
        },
      } as never);
    },
  };
}

function getKbCollectionSlashItem(
  editor: BlockNoteEditor<never, never, never>,
  pageId?: string | null,
) {
  return {
    title: "Коллекция",
    subtext: "Список дочерних страниц со свойствами",
    aliases: ["collection", "database", "db", "база", "коллекция", "список"],
    group: "Базовые блоки",
    icon: <Database className="size-4 text-brand" />,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, {
        type: "collection",
        props: {
          view: "list",
          title: "Коллекция",
          viewTitle: "Галерея",
          collectionId: pageId
            ? getPageCollectionId(pageId)
            : createCollectionId(),
          schemaJson: KB_COLLECTION_EMPTY_SCHEMA,
          visibleFieldIdsJson: KB_COLLECTION_DEFAULT_VISIBLE_FIELDS,
          fieldOrderIdsJson: KB_COLLECTION_DEFAULT_VISIBLE_FIELDS,
          viewId: "",
        },
      } as never);
    },
  };
}

/**
 * BlockNote editor wrapped to plug into Sheerly DS. Uses the
 * `@blocknote/shadcn` variant — BlockNote renders its own UI through
 * shadcn/Radix primitives, so colors/spacing/radii inherit from our
 * existing CSS variables in globals.css.
 *
 * Sheerly-specific overrides for `--bn-*` tokens (font-family, border
 * radius, internal palette) live in globals.css under the
 * `.bn-shadcn` scope.
 */
/** Block-types на которых не нужны comment-кнопки (BN-comments крепятся
 *  на текстовый Yjs-mark, для leaf-блоков без content создание комментария
 *  превращается в no-op). Скрываем `addCommentButton` /
 *  `addTiptapCommentButton` при выделении такого блока в editable
 *  режиме И блокируем auto-открытие composer'а в locked-режиме.
 *
 *  - `image/video/audio/file` — атомарные media-leaf'ы.
 *  - `divider` — horizontal rule, тоже leaf без inline-content; коммент
 *    к нему создал бы пустой thread без видимого якоря.
 *  - `table` — block-level комментарий бесполезен (как и на media-
 *    leaf'ах). На editable дополнительно различаем «collapsed selection
 *    → запрет, выделенный текст в ячейке → разрешён» в
 *    filterToolbarItemsForBlock; на locked-режиме селекшн идёт через
 *    auto-composer, и так же запрещаем для всей таблицы (см.
 *    selectionUpdate-handler ниже).
 */
const NON_COMMENTABLE_BLOCK_TYPES = new Set([
  "image",
  "video",
  "audio",
  "file",
  "divider",
  "gallery",
  "collection",
]);

/** Locked-режим: дополнительно к выше — `table`. На locked auto-
 *  composer открывается на любое выделение (см. selectionUpdate-effect),
 *  и юзер не различает «выделил текст в ячейке» vs «выделил блок» —
 *  чтобы не плодить «болтающиеся» mark'и в table-cell, запрещаем
 *  весь тип целиком. На editable различаем (см. filterToolbarItemsForBlock).
 */
const NON_COMMENTABLE_LOCKED_BLOCK_TYPES = new Set([
  ...NON_COMMENTABLE_BLOCK_TYPES,
  "table",
]);

const NO_FORMATTING_TOOLBAR_BLOCK_TYPES = new Set(["gallery", "collection"]);

function getActiveBlockType(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: BlockNoteEditor<any, any, any>,
): string | undefined {
  try {
    return editor.getTextCursorPosition().block?.type;
  } catch {
    return undefined;
  }
}

/** Lucide-иконка как IconType (react-icons-совместимый shape) — BN'ный
 *  `BlockTypeSelectItem.icon` ждёт react-icons. Default react-icons/ri
 *  (RiH1 / RiH2 / RiText / ...) — filled-paths и визуально жирные. У
 *  нас всё остальное в DS — lucide stroke 1.5px, дроп-даун стиля
 *  выбивается. Подменяем на lucide. */
const lucideAsIcon = (
  Comp: LucideIcon,
  strokeWidth = 1.75,
): IconType => {
  const Wrapped: IconType = ({ size, ...rest }) => (
    <Comp
      width={size ?? 16}
      height={size ?? 16}
      strokeWidth={strokeWidth}
      {...(rest as Record<string, unknown>)}
    />
  );
  Wrapped.displayName = `LucideIcon(${Comp.displayName ?? Comp.name ?? "Anonymous"})`;
  return Wrapped;
};

/** Custom items для BN's BlockTypeSelect — те же типы блоков, что и
 *  default'ные, но с lucide-иконками. Названия берём из BN-default'а
 *  (он синхронизирован с нашим slash-меню override). */
function getKbBlockTypeSelectItems(
  defaults: BlockTypeSelectItem[],
): BlockTypeSelectItem[] {
  const ICON_MAP: Record<string, LucideIcon> = {
    paragraph: Type,
    "heading:1:false": Heading1,
    "heading:2:false": Heading2,
    "heading:3:false": Heading3,
    "heading:4:false": Heading4,
    "heading:5:false": Heading5,
    "heading:6:false": Heading6,
    "heading:1:true": ListCollapse,
    "heading:2:true": ListCollapse,
    "heading:3:true": ListCollapse,
    quote: Quote,
    bulletListItem: List,
    numberedListItem: ListOrdered,
    checkListItem: ListChecks,
    toggleListItem: ListCollapse,
  };
  return defaults.map((item) => {
    const level = item.props?.level;
    const isToggleable = item.props?.isToggleable;
    const key =
      item.type === "heading"
        ? `heading:${level}:${isToggleable}`
        : item.type;
    const lucide = ICON_MAP[key];
    if (!lucide) return item;
    return { ...item, icon: lucideAsIcon(lucide) };
  });
}

function filterToolbarItemsForBlock(
  items: ReturnType<typeof getFormattingToolbarItems>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: BlockNoteEditor<any, any, any>,
): ReturnType<typeof getFormattingToolbarItems> {
  const blockType = getActiveBlockType(editor);
  if (!blockType) return items;

  // Leaf-блоки без inline-content (image/video/audio/file/divider) +
  // table: comment всегда no-op либо нежелателен (в table block-level
  // mark рисуется на всей строке/ячейке, что юзеру не нужно — раньше
  // мы пробовали разрешать на «выделенный текст в ячейке», но это
  // путало UX). Фильтруем кнопки целиком.
  if (
    NON_COMMENTABLE_BLOCK_TYPES.has(blockType) ||
    blockType === "table"
  ) {
    return items.filter(
      (it) =>
        it.key !== "addCommentButton" && it.key !== "addTiptapCommentButton",
    );
  }

  return items;
}

/** Заменяет все file-toolbar кнопки (caption / replace / rename /
 *  delete / download / preview) на наши версии с lucide-иконками
 *  + shadcn Popover'ами. BN-default'ные используют react-icons (Ri*)
 *  и `Generic.Form.TextInput` — оба элемента не совпадают с нашим DS.
 *  Особенно важно для `replaceFileButton` — его popover рендерит свой
 *  default-FilePanel вместо нашего `KbFilePanel` (controller хукается
 *  только в initial-add-block flow). См. kb-file-toolbar-buttons.tsx
 *  + kb-file-replace-button.tsx. */
function swapFileToolbarButtons(
  items: ReturnType<typeof getFormattingToolbarItems>,
): ReturnType<typeof getFormattingToolbarItems> {
  return items
    .filter((it) => {
      // BN-default `filePreviewButton` toggle'ит showPreview prop
      // у image/video/audio (chip ↔ inline-preview). Юзер просил
      // убрать эту функцию — медиа всегда в preview-режиме. Совсем
      // выкидываем кнопку из toolbar'а; legacy-блоки с
      // `showPreview=false` всё равно рендерятся через KbMediaChip
      // (см. kb-video/audio/image-block.tsx) — обратной совместимости
      // ради, но новые блоки toggle уже не получат.
      return it.key !== "filePreviewButton";
    })
    .map((it) => {
      switch (it.key) {
        case "fileCaptionButton":
          return <KbFileCaptionButton key={it.key} />;
        case "replaceFileButton":
          return <KbFileReplaceButton key={it.key} />;
        case "fileRenameButton":
          return <KbFileRenameButton key={it.key} />;
        case "fileDeleteButton":
          return <KbFileDeleteButton key={it.key} />;
        case "fileDownloadButton":
          return <KbFileDownloadButton key={it.key} />;
        default:
          return it;
      }
    });
}

export function KbBlockNoteEditor({
  initialContent,
  pageId = null,
  editable = true,
  onChange,
  uploadFile,
  resolveFileUrl,
  renderExtras,
  customSideMenu = false,
  customSlashMenu = false,
  aiSlashEnabled = false,
  onCreateNestedPage,
  commentsBundle = null,
  className,
}: BlockNoteEditorProps) {
  const { resolvedTheme } = useTheme();

  // BlockNote requires `initialContent` to be defined as a non-empty
  // array on construction; an empty/missing one becomes the default
  // empty document. We freeze the value via useMemo so React 19 strict
  // mode doesn't churn the editor instance on re-renders.
  const initial = useMemo(
    () => (initialContent && initialContent.length > 0 ? initialContent : undefined),
    // Intentionally not in deps: BlockNote owns the document after
    // mount; switching pages remounts the component (key={pageId}).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Stable refs for BlockNote callbacks — useCreateBlockNote uses the
  // options object only on first construction. Without refs, re-renders
  // would either churn the editor (if we re-pass a fresh function
  // literal) or capture a stale callback.
  const uploadFileRef = useRef(uploadFile);
  uploadFileRef.current = uploadFile;
  const resolveFileUrlRef = useRef(resolveFileUrl);
  resolveFileUrlRef.current = resolveFileUrl;

  // Stable bridge functions — built once per (presence-of-handler).
  // These are what BlockNote sees in its options dep array; they
  // forward to the latest ref'd handler. Critical: if these had
  // changed identity on every render, useCreateBlockNote would tear
  // down + recreate the editor on every save-state change, closing
  // the slash menu and losing in-flight UI state.
  const hasUpload = !!uploadFile;
  const hasResolve = !!resolveFileUrl;

  const stableUploadFile = useMemo(() => {
    if (!hasUpload) return undefined;
    return async (file: File) => {
      const fn = uploadFileRef.current;
      if (!fn) throw new Error("uploadFile handler not provided");
      return fn(file);
    };
  }, [hasUpload]);

  const stableResolveFileUrl = useMemo(() => {
    if (!hasResolve) return undefined;
    return async (url: string) => {
      const fn = resolveFileUrlRef.current;
      return fn ? fn(url) : url;
    };
  }, [hasResolve]);

  // Customise placeholders to match Sheerly tone-of-voice
  // (русский, без иностранных «type / for commands»). Patches the
  // built-in `ru` dictionary in-place — cheap because it's just a
  // shallow object spread.
  const dictionary = useMemo(() => {
    // Slash-menu / BlockTypeSelect titles в default ru locale записаны
    // длинно («Заголовок 1 уровня», «Сворачиваемый заголовок 1 уровня»)
    // — в дроп-дауне стилей это вызывает перенос строки. По дизайну
    // sheerly.pen (frame 06 · jMZQR) пункт = «Заголовок 1». Перебиваем
    // только title (subtext / aliases / group остаются как у BN —
    // search по ним продолжает работать с длинными формами).
    const slash = ruLocale.slash_menu;
    return {
      ...ruLocale,
      placeholders: {
        ...ruLocale.placeholders,
        default: 'Введите текст или нажмите "/" для команд',
        emptyDocument: 'Начните печатать или нажмите "/" для команд',
        new_comment: "Напишите комментарий…",
        edit_comment: "Редактировать комментарий…",
        comment_reply: "Ответить…",
      },
      slash_menu: {
        ...slash,
        heading: { ...slash.heading, title: "Заголовок 1" },
        heading_2: { ...slash.heading_2, title: "Заголовок 2" },
        heading_3: { ...slash.heading_3, title: "Заголовок 3" },
        heading_4: { ...slash.heading_4, title: "Заголовок 4" },
        heading_5: { ...slash.heading_5, title: "Заголовок 5" },
        heading_6: { ...slash.heading_6, title: "Заголовок 6" },
        toggle_heading: {
          ...slash.toggle_heading,
          title: "Сворачиваемый заголовок 1",
        },
        toggle_heading_2: {
          ...slash.toggle_heading_2,
          title: "Сворачиваемый заголовок 2",
        },
        toggle_heading_3: {
          ...slash.toggle_heading_3,
          title: "Сворачиваемый заголовок 3",
        },
      },
    };
  }, []);

  // Кастомная schema = default-blocks + наш callout. Создаём один раз
  // на mount (useMemo с пустыми deps) — пересборка schema'ы пересоздала
  // бы editor instance, что сломало бы in-flight UI.
  const schema = useMemo(
    () =>
      BlockNoteSchema.create({
        blockSpecs: {
          ...defaultBlockSpecs,
          callout: kbCalloutBlock(),
          // Замена встроенного `quote` блока: добавляем размеры
          // (default / large) и стиль (line / quotes). Старые документы
          // совместимы — backgroundColor/textColor оставлены, новые
          // size/variant дефолтятся в "default"/"line", что эквивалентно
          // прежнему виду.
          quote: kbQuoteBlock(),
          // Custom video block c iframe-fallback'ом для YouTube /
          // Vimeo / Loom / Vidyard. См. kb-video-block.tsx.
          // createReactBlockSpec возвращает фабрику (options => spec),
          // вызываем без options как и для callout-блока.
          video: kbVideoBlockSpec(),
          // Custom audio/file/image — единственное отличие от
          // дефолтных: empty-state CTA («Добавить аудио / файл /
          // изображение») рендерит lucide-иконку вместо react-icons
          // RiVolumeUpFill / RiFile2Line / RiImage2Fill. Логика
          // upload / preview / parse — BN-default'ная.
          audio: kbAudioBlockSpec(),
          file: kbFileBlockSpec(),
          image: kbImageBlockSpec(),
          gallery: kbGalleryBlockSpec(),
          collection: kbCollectionBlockSpec(),
        },
        inlineContentSpecs: {
          ...defaultInlineContentSpecs,
          kbPageMention: kbPageMentionInlineContent,
          kbStaffMention: kbStaffMentionInlineContent,
        },
      }),
    [],
  );

  // CommentsExtension (если commentsBundle передан). Создаётся один
  // раз при mount'е через useMemo с пустым deps — иначе пересборка
  // расширения пересоздаст editor instance, что сломает in-flight UI.
  // Если bundle null/undefined — extensions = []. Эту опцию BlockNote
  // принимает в useCreateBlockNote.
  //
  // ВАЖНО: schema передаётся в CommentsExtension, чтобы внутренний
  // comment-editor (используется ThreadsSidebar и default-FloatingThread
  // при рендере body) знал про наш kbStaffMention. Без этого опции
  // ThreadsSidebar падает с «node type kbStaffMention not found in
  // schema» при рендере коммента с @-mention chip'ом.
  const commentsExtension = useMemo(() => {
    if (!commentsBundle) return null;
    return CommentsExtension({
      threadStore: commentsBundle.threadStore,
      resolveUsers: commentsBundle.resolveUsers,
      schema: schema as never,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editor = useCreateBlockNote({
    schema,
    initialContent: initial as never,
    uploadFile: stableUploadFile,
    resolveFileUrl: stableResolveFileUrl,
    dictionary,
    // BN-internal'ная типизация `extensions` ждёт `Extension |
    // ExtensionFactoryInstance`, но проверяет identity через свой
    // re-export @tiptap/core; наш direct-import @tiptap/core type'ы
    // не сходятся 1:1 (хотя runtime-shape идентичен — версия 3.22.5
    // та же). `as never` — стандартный приём здесь, как делает BN
    // в кастомных extension'ах.
    extensions: [
      KbHeadingEnterExtension,
      ...(commentsExtension ? [commentsExtension] : []),
    ],
    // Advanced Tables (BlockNote 0.49 built-in, без отдельного пакета):
    //   splitCells           — разбить ячейку на N (через context-menu по правому клику)
    //   cellBackgroundColor  — раскрашивать фон ячеек
    //   cellTextColor        — цвет текста в ячейке
    //   headers              — отдельный визуальный/семантический header-row
    //                          (можно тогглить из table-handles)
    // Сериализация в jsonb остаётся agnostic — kb_save_page (миграция 052)
    // не парсит структуру. Markdown-export (lib/knowledge/blocks-to-markdown.ts)
    // уже корректно проходит через cellRuns(cell) после Codex-fix #41 P1,
    // headers/colors просто не сериализуются в md (lossy by design).
    tables: {
      splitCells: true,
      cellBackgroundColor: true,
      cellTextColor: true,
      headers: true,
    },
    // Custom pasteHandler — подменяем сломанные `<img>` тэги на курсивный
    // text-placeholder ПЕРЕД вставкой. Без этого Cmd+V из Notion / Word /
    // Confluence (HTML с `<img src="filename.jpg">`) создавал бы image-
    // блоки с относительными URL'ами → broken-image иконка с alt-text.
    //
    // Real binary clipboard (screenshot, copy from Finder) BlockNote
    // обрабатывает default-handler'ом через uploadFile — туда не лезем.
    //
    // Реализация — через **строковый replace + editor.pasteHTML(cleaned)**,
    // чтобы сохранить core-семантику пасты: вставка в caret-позицию /
    // замена текущего selection. Старый вариант (parse → rewrite blocks
    // → insertBlocks(…, "after")) ломал эту семантику, см. Codex P1
    // на PR #56.
    pasteHandler: ({ event, editor: ed, defaultPasteHandler }) => {
      const data = event.clipboardData;
      if (!data) return defaultPasteHandler();

      // Real files в clipboard → default handler вызывает uploadFile.
      const hasFiles =
        data.types.includes("Files") && (data.files?.length ?? 0) > 0;
      if (hasFiles) return defaultPasteHandler();

      if (data.types.includes("text/html")) {
        const html = data.getData("text/html");
        if (html && htmlHasBrokenImg(html)) {
          // BlockNote-paste-extension уже сделал preventDefault до того,
          // как вызвал нас, так что просто отдаём ему очищенный HTML
          // и говорим «обработано» (return true).
          ed.pasteHTML(stripBrokenImgInHtml(html));
          return true;
        }
      }
      return defaultPasteHandler();
    },
  });

  // FloatingComposer guard: BlockNote's CommentsExtension автоматически
  // сбрасывает pendingComment при ЛЮБОМ selection-change в outer
  // editor'е (node_modules/@blocknote/core/dist/comments.js:165 —
  // `t.onSelectionChange(() => { pendingComment && setState(false) })`).
  // Когда юзер кликает или autoFocus'ится в FloatingComposer'е (внутренний
  // редактор для ввода коммента), focus уходит из outer ProseMirror'а →
  // outer фиксирует selection-change → pendingComment=false → composer
  // unmount'ится прежде чем юзер что-то ввёл.
  //
  // Workaround: monkey-patch'им `store.setState` extension'а так, чтобы
  // он БЛОКИРОВАЛ переход pendingComment true→false когда:
  //   • focus сейчас внутри `.bn-thread` (composer card),
  //   • И не было recent click'а на кнопку внутри composer'а (Save),
  //   • И не было recent Escape (закрытие через клавиатуру).
  // Закрытие через Save / Escape / click outside — пропускаем как и
  // раньше. Spurious blur'ы — в null. Никакого flicker'а / re-mount'а
  // FloatingComposer'а: clear не доходит до listeners в принципе.
  // Пробрасываем outer-editor reference в SupabaseThreadStore: он
  // нужен для (а) addThreadToDocument — apply mark в editor (б)
  // applyAllMarksToEditor — re-apply mark'ов из metadata.position
  // после загрузки треда (в) captureCommentMarkPositions —
  // walk PM-doc на save'е чтобы записать drift в metadata. См.
  // комментарий в comments-store.ts «Position-persistence для
  // comment-mark'ов».
  useEffect(() => {
    if (!commentsBundle) return;
    const store = commentsBundle.threadStore as unknown as {
      setEditor?: (editor: unknown) => void;
      applyAllMarksToEditor?: () => void;
    };
    if (typeof store.setEditor === "function") {
      store.setEditor(editor);
    }
    // Apply marks на КАЖДЫЙ notify: initial-load + любой realtime
    // INSERT/UPDATE треда (когда другой юзер создаёт comment, через
    // postgres_changes broadcast прилетает в threadCache → notify).
    // Без re-apply на каждом notify тред у юзера-получателя сидит в
    // cache, но mark в редакторе не появляется — комментарий «невидимый»
    // до F5. addMark идемпотентен: повторное применение на уже
    // помеченном диапазоне — no-op.
    const subscribable = commentsBundle.threadStore as unknown as {
      subscribe?: (cb: () => void) => () => void;
    };
    const unsub = subscribable.subscribe?.(() => {
      // micro-delay чтобы PM успел dispatch initial-content
      // transactions при первой загрузке doc'а; на последующих
      // notify'ях тоже безвреден.
      setTimeout(() => {
        store.applyAllMarksToEditor?.();
      }, 0);
    });
    return () => {
      unsub?.();
    };
  }, [editor, commentsBundle]);

  // Locked-страница + юзер может комментировать: на любое выделение
  // непустого диапазона текста сразу открываем composer (Notion-style),
  // минуя formatting-toolbar bubble. Раньше юзеру приходилось:
  // select → видеть toolbar → click AddCommentButton. Теперь:
  // select → composer открыт. Также чинит баг «второй коммент не
  // открывается»: при каждом новом выделении проверяем pendingComment
  // и стартуем заново, если оно false (после save / escape).
  useEffect(() => {
    if (!commentsBundle?.canComment) return;
    if (editable) return;
    const tiptap = (editor as unknown as {
      _tiptapEditor?: {
        on: (event: string, cb: () => void) => void;
        off: (event: string, cb: () => void) => void;
        state: { selection: { empty: boolean; from: number; to: number } };
      };
    })._tiptapEditor;
    if (!tiptap) return;
    const ext = (editor as unknown as {
      getExtension: (cls: unknown) => unknown;
    }).getExtension(CommentsExtension) as
      | {
          startPendingComment?: () => void;
          store?: { state: { pendingComment: boolean } };
        }
      | null;
    if (!ext) return;
    const handler = () => {
      const sel = tiptap.state.selection;
      if (sel.empty || sel.from === sel.to) return;
      // Block-type guard: на media-leaf'ах / divider'е / table коммент
      // не имеет смысла (см. NON_COMMENTABLE_LOCKED_BLOCK_TYPES). Тут
      // single source of truth с editable-режимом — запрет parallel
      // тому, что filterToolbarItemsForBlock делает в editable
      // formatting-toolbar'е.
      try {
        const blockType = (
          editor as unknown as {
            getTextCursorPosition: () => { block?: { type?: string } };
          }
        ).getTextCursorPosition().block?.type;
        if (blockType && NON_COMMENTABLE_LOCKED_BLOCK_TYPES.has(blockType)) {
          return;
        }
      } catch {
        /* fallthrough — conservative default = allow */
      }
      if (ext.store?.state.pendingComment) return;
      ext.startPendingComment?.();
    };
    tiptap.on("selectionUpdate", handler);
    return () => {
      tiptap.off("selectionUpdate", handler);
    };
  }, [editor, editable, commentsBundle]);

  useEffect(() => {
    if (!commentsBundle) return;
    const ext = (editor as unknown as {
      getExtension: (cls: unknown) => unknown;
    }).getExtension(CommentsExtension);
    if (!ext) return;
    const extWithStore = ext as {
      store?: {
        state: { pendingComment: boolean };
        setState: (
          updater:
            | Partial<{ pendingComment: boolean }>
            | ((s: { pendingComment: boolean }) => Partial<{
                pendingComment: boolean;
              }>),
        ) => void;
      };
    };
    const store = extWithStore.store;
    if (!store) return;

    // Sticky-флаг: «юзер запросил закрытие composer'а» (Save / Escape /
    // click outside). Без time-window — Save'у в SupabaseThreadStore
    // нужно дождаться 2-х sequential INSERT'ов (см. comments-store.ts:
    // createThread), что на медленной сети может уйти за 500мс. К моменту
    // когда `stopPendingComment()` наконец дойдёт до setState, гипотетический
    // time-gate уже истёк бы, и мы бы заблокировали legitimate close. См.
    // Codex #68 P1.
    //
    // Логика: флаг ставится сразу на pointerdown/click button-в-composer'е
    // или Escape, держится до next pendingComment-transition (любого) и
    // сбрасывается там. На re-open (false→true) тоже сбрасываем — на
    // случай если предыдущий close был заблокирован, чтобы не остался
    // «протухший» intent.
    let intentionalClose = false;
    const markIntentionalClose = (e: Event) => {
      const target = e.target as Element | null;
      if (
        target?.closest?.('.bn-thread button, .bn-thread [role="button"]')
      ) {
        intentionalClose = true;
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") intentionalClose = true;
    };
    document.addEventListener("pointerdown", markIntentionalClose, true);
    document.addEventListener("click", markIntentionalClose, true);
    document.addEventListener("keydown", onKeyDown, true);

    const originalSetState = store.setState;
    store.setState = ((updater: unknown) => {
      const prev = store.state;
      const next =
        typeof updater === "function"
          ? (
              updater as (s: { pendingComment: boolean }) => Partial<{
                pendingComment: boolean;
              }>
            )(prev)
          : (updater as Partial<{ pendingComment: boolean }>);
      const closing =
        next?.pendingComment === false && prev.pendingComment === true;
      const opening =
        next?.pendingComment === true && prev.pendingComment === false;

      if (closing) {
        if (intentionalClose) {
          intentionalClose = false; // consumed
        } else {
          const active = document.activeElement;
          const insideComposer = !!active?.closest?.(
            ".bn-thread, .bn-comment-editor",
          );
          // Фокус внутри composer'а + нет intentional-флага = spurious
          // blur от outer-editor'а. Блокируем close, состояние не меняется.
          if (insideComposer) return;
        }
      } else if (opening) {
        // Новый цикл — сбрасываем lingering intent (если предыдущий
        // close был заблокирован, флаг мог остаться).
        intentionalClose = false;
      }
      originalSetState.call(
        store,
        updater as Parameters<typeof originalSetState>[0],
      );
    }) as typeof store.setState;

    return () => {
      store.setState = originalSetState;
      document.removeEventListener("pointerdown", markIntentionalClose, true);
      document.removeEventListener("click", markIntentionalClose, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [editor, commentsBundle]);

  // Subscribe to document changes; surface only the document. Full-text
  // projection is intentionally deferred to the debounced save boundary.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!onChangeRef.current) return;
    // Тип `ed` берём как у нашего editor'а (расширенный schema с
     // callout) — иначе TS ругается на несовместимость дефолтного
     // BlockNoteEditor<defaultSchema> с нашим типизированным.
    const unsubscribe = editor.onChange((ed) => {
      const handler = onChangeRef.current;
      if (!handler) return;
      handler({
        content: ed.document as unknown as KbBlock[],
      });
    });
    return unsubscribe;
  }, [editor]);

  const collectionRuntime = useMemo(
    () => ({
      pageId,
      canCreatePages: Boolean(onCreateNestedPage),
    }),
    [pageId, onCreateNestedPage],
  );

  return (
    <KbCollectionRuntimeProvider value={collectionRuntime}>
      <BlockNoteView
        editor={editor}
        editable={editable}
        theme={resolvedTheme === "dark" ? "dark" : "light"}
        className={cn("bn-sheerly", className)}
        sideMenu={customSideMenu ? false : undefined}
        slashMenu={customSlashMenu ? false : undefined}
        // Default formatting-toolbar отключаем когда мы добавляем свои
        // кнопки через FormattingToolbarController (ниже): иначе
        // BlockNote рендерит ОБА toolbar'а на выделение → дубликат
        // всех контролов. Триггер кастомизации — aiSlashEnabled ИЛИ
        // commentsBundle (любой включает кастомный controller).
        // См. Codex #54 P2.
        formattingToolbar={aiSlashEnabled || commentsBundle ? false : undefined}
        // Default LinkToolbar отключаем — рендерим свой
        // <LinkToolbarController> (ниже), который для KB-links возвращает
        // null. Без этого флага BlockNote рендерил бы ОБА toolbar'а:
        // дефолтный (показывает «Изменить ссылку» для всех URL'ов) +
        // наш кастомный (null для kb-links). Юзер видел overlap. См.
        // Codex #67 P1.
        linkToolbar={false}
        // Default Comments UI (FloatingComposer + FloatingThread от BN)
        // отключаем когда есть commentsBundle — мы рендерим свой
        // <FloatingComposerController floatingComposer={KbFloatingComposer}>
        // ниже. Без этого флага BN'овский DefaultUI ВСЁ РАВНО монтирует
        // свой default-FloatingComposerController параллельно нашему
        // → юзер видел два composer'а одновременно (мой Notion-style
        // сверху + дефолтный BN с «Save» снизу), что фрагментировало
        // фокус и закрывало кастомный popover.
        comments={commentsBundle ? false : undefined}
        // Default FilePanel отключаем — рендерим свой `KbFilePanel`
        // через `FilePanelController` ниже (Notion-style drop-zone +
        // URL-tab под дизайн sheerly.pen frame 13 / 13b).
        filePanel={false}
      >
        <FilePanelController filePanel={KbFilePanel} />
        {customSlashMenu && (
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) => {
            // Кастомный порядок групп под дизайн (sheerly.pen):
            //   Заголовки → Подзаголовки → Базовые блоки → Подсказки →
            //   Медиа → Прочее.
            // BN-default'ы дают «Продвинутый» (только Таблица) — мы её
            // переносим в «Прочее» и группу ликвидируем целиком (Codex
            // user-feedback: «раздел "Продвинутый" можно убрать»).
            // AI-команды НЕ дублируются в slash-меню — они живут в
            // KbAiFormattingButton.
            const defaults = getDefaultReactSlashMenuItems(editor);
            const callouts = getKbCalloutSlashItems(editor as never);
            const galleryItem = getKbGallerySlashItem(editor as never);
            const collectionItem = getKbCollectionSlashItem(
              editor as never,
              pageId,
            );
            // «Новая страница» — первая в группе «Базовые блоки», если
            // хост передал колбэк (= юзер имеет `kb.create_pages`).
            const newPageItem = onCreateNestedPage
              ? [getKbNewPageSlashItem(onCreateNestedPage)]
              : [];
            const emojiItem = getKbEmojiSlashItem(editor as never);
            const byGroup = (...names: string[]) =>
              defaults.filter((it) =>
                names.includes((it as { group?: string }).group ?? ""),
              );
            const remap = (
              items: ReturnType<typeof getDefaultReactSlashMenuItems>,
              from: string,
              to: string,
            ) =>
              items.map((it) => {
                const cur = (it as { group?: string }).group;
                return cur === from
                  ? ({ ...it, group: to } as typeof it)
                  : it;
              });
            const headings = byGroup("Заголовки");
            const subheadings = byGroup("Подзаголовки");
            const basics = byGroup("Базовые блоки", "Основные блоки");
            // Расширяем aliases для media-items: BN-default ru-locale
            // даёт {image, картинка, рисунок, ...}, юзер просил «фото»
            // и «изображение» (см. PR #159 фидбек). Добавляем в title-
            // соответствующий item, не трогая остальные.
            const media = byGroup("Медиа").map((it) => {
              const item = it as { title?: string; aliases?: string[] };
              if (item.title === "Картинка") {
                return {
                  ...it,
                  aliases: [
                    ...(item.aliases ?? []),
                    "фото",
                    "изображение",
                  ],
                };
              }
              return it;
            });
            // «Продвинутый» сейчас содержит только Таблицу — переименуем
            // её группу в «Прочее» и склеим с эмодзи.
            const others = remap(
              byGroup("Прочее", "Продвинутый"),
              "Продвинутый",
              "Прочее",
            );
            // Order: Заголовки → Базовые блоки (с «Новая страница»
            // первой) → Подсказки → Подзаголовки → Медиа → Прочее
            // (по запросу пользователя).
            const ordered = [
              ...headings,
              ...newPageItem,
              collectionItem,
              ...basics,
              ...callouts,
              ...subheadings,
              galleryItem,
              ...media,
              ...others,
              emojiItem,
            ];
            return filterSuggestionItems(
              ordered as ReturnType<typeof getDefaultReactSlashMenuItems>,
              query,
            );
            }}
            // Custom render — KbSlashMenu добавляет hover-hold tooltip
            // (1.2 sec) с описанием пункта + скрывает subtext в основном
            // списке через wrapper-класс `.kb-slash-menu`. `@`-меню
            // (kb-mention-menu.tsx) использует другой
            // SuggestionMenuController и рендерит дефолтный
            // SuggestionMenu — там subtext остаётся видимым.
            suggestionMenuComponent={KbSlashMenu}
          />
        )}
        {(aiSlashEnabled || commentsBundle) && (
          <FormattingToolbarController
            formattingToolbar={() => {
            // Locked-страница + юзер может комментировать:
            // toolbar НЕ показываем — composer открывается сам по
            // выделению (см. selectionUpdate-effect выше). Раньше тут
            // была кнопка AddCommentButton, юзеру неудобно: select →
            // видеть toolbar → клик. Теперь Notion-style: select → composer.
            if (!editable && commentsBundle?.canComment) return null;
            const blockType = getActiveBlockType(editor);
            if (
              blockType &&
              NO_FORMATTING_TOOLBAR_BLOCK_TYPES.has(blockType)
            ) {
              return null;
            }
            return (
              <FormattingToolbar>
                {editable ? (
                  <>
                    {/* Comment-кнопки (`addCommentButton` /
                     *  `addTiptapCommentButton`) фильтрутся на media-
                     *  блоках: BN attaches comments к тексту через
                     *  Yjs-mark, а image / video / audio / file —
                     *  атомарные leaf-node'ы без inline-content; click
                     *  ничего не делает кроме рендера empty composer'а.
                     *  Чтобы юзер не получал «мёртвую» кнопку, выпиливаем
                     *  её на этих типах блоков. */}
                    {filterToolbarItemsForBlock(
                      swapFileToolbarButtons(
                        getFormattingToolbarItems(
                          getKbBlockTypeSelectItems(
                            defaultBlockTypeSelectItems(editor.dictionary),
                          ),
                        ),
                      ),
                      editor,
                    )}
                    {aiSlashEnabled && (
                      <KbAiFormattingButton aiEnabled={aiSlashEnabled} />
                    )}
                  </>
                ) : null}
              </FormattingToolbar>
            );
            }}
          />
        )}
      {/* Custom LinkToolbar: для @-mention'ов на KB-страницы (URL'ы вида
          `/knowledge/...`) BN-овский toolbar бесполезен — «Изменить
          ссылку» сломал бы slug-binding @-mention'а, а у нас и так есть
          богаче KbLinkPreview с заголовком + breadcrumb'ом + reading-time.
          Два поповера на один линк выглядели грязно (см. user-feedback).
          Для внешних URL'ов оставляем дефолт BN — там Edit/Open/Unlink
          реально нужны. */}
        <LinkToolbarController
          linkToolbar={(props) =>
            props.url?.startsWith("/knowledge/") ? null : (
              <LinkToolbar {...props} />
            )
          }
        />
      {/* Comments controllers — рендерятся только если bundle передан.
          FloatingComposerController — pop-up «нового комментария» при
          клике на AddCommentButton. Дефолтный composer — голый
          textarea с Save-кнопкой, заменяем на Notion-style карточку
          с avatar + send-button (см. kb-floating-composer.tsx).
          FloatingThreadController — открывает thread при клике по
          существующему comment-mark'у; пока default. */}
        {commentsBundle && (
          <>
            <FloatingComposerController
              floatingComposer={() => (
                <KbFloatingComposer
                  currentUserName={commentsBundle.currentUserName}
                  currentUserAvatarUrl={commentsBundle.currentUserAvatarUrl}
                />
              )}
            />
            <FloatingThreadController
              floatingThread={(props) => (
                <KbFloatingThread
                  thread={props.thread}
                  selected={props.selected ?? false}
                />
              )}
            />
          </>
        )}
        {renderExtras?.(editor as unknown as BlockNoteEditor)}
        <KbEmojiPickerOverlay />
      </BlockNoteView>
    </KbCollectionRuntimeProvider>
  );
}
