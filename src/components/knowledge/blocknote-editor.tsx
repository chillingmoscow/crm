"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useTheme } from "next-themes";
import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
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
  AddCommentButton,
  FloatingComposerController,
  FloatingThreadController,
} from "@blocknote/react";
import { flip, shift, offset, size } from "@floating-ui/react";
import { Info, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { blocksToPlainText } from "@/lib/knowledge/plain-text";
import { kbCalloutBlock } from "@/components/knowledge/blocks/kb-callout-block";
import { getKbAiSlashItems } from "@/app/(dashboard)/knowledge/_components/kb-ai-slash-items";
import { KbAiFormattingButton } from "@/app/(dashboard)/knowledge/_components/kb-ai-formatting-button";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

import type { KbBlock } from "@/types/knowledge";

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
  /**
   * Read-only preview mode (e.g. version history snapshots).
   * Disables editing and hides the side menu / formatting toolbar.
   */
  editable?: boolean;
  /**
   * Fires on every editor change (after a brief BlockNote-internal
   * debounce). Receives the BlockNote document and a synchronously-
   * computed plain-text projection — pass both into the savePage
   * server action.
   *
   * Caller is responsible for outer debouncing (~1.5s) before hitting
   * the network.
   */
  onChange?: (args: { content: KbBlock[]; plainText: string }) => void;
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
export function KbBlockNoteEditor({
  initialContent,
  editable = true,
  onChange,
  uploadFile,
  resolveFileUrl,
  renderExtras,
  customSideMenu = false,
  customSlashMenu = false,
  aiSlashEnabled = false,
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
        },
      }),
    [],
  );

  // CommentsExtension (если commentsBundle передан). Создаётся один
  // раз при mount'е через useMemo с пустым deps — иначе пересборка
  // расширения пересоздаст editor instance, что сломает in-flight UI.
  // Если bundle null/undefined — extensions = []. Эту опцию BlockNote
  // принимает в useCreateBlockNote.
  const commentsExtension = useMemo(() => {
    if (!commentsBundle) return null;
    return CommentsExtension({
      threadStore: commentsBundle.threadStore,
      resolveUsers: commentsBundle.resolveUsers,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editor = useCreateBlockNote({
    schema,
    initialContent: initial as never,
    uploadFile: stableUploadFile,
    resolveFileUrl: stableResolveFileUrl,
    dictionary,
    extensions: commentsExtension ? [commentsExtension] : undefined,
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
  });

  // Subscribe to document changes; surface as { content, plainText }.
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
      // blocksToMarkdownLossy is async — but for plain_text we just
      // want a search-index projection, not perfect Markdown. Walk
      // the document in-place (cheap, ~µs even for huge docs).
      const plainText = blocksToPlainText(ed.document as unknown as KbBlock[]);
      handler({
        content: ed.document as unknown as KbBlock[],
        plainText,
      });
    });
    return unsubscribe;
  }, [editor]);

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      className={cn("bn-sheerly", className)}
      sideMenu={customSideMenu ? false : undefined}
      slashMenu={customSlashMenu ? false : undefined}
      // AI кнопка живёт во встроенном formatting-toolbar'е (он
      // всплывает при выделении текста). Отключаем default и рендерим
      // controller с дополнительной кнопкой ниже.
      formattingToolbar={aiSlashEnabled ? false : undefined}
    >
      {customSlashMenu && (
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            // Cast to default-suggestion-item shape: callout/AI items
            // имеют ту же runtime-форму (title, subtext, group, icon,
            // onItemClick), но TS этого не видит из-за расширенной
            // schema'ы. SuggestionMenuController generic выводится
            // только из default-items.
            filterSuggestionItems(
              [
                ...getDefaultReactSlashMenuItems(editor),
                ...getKbCalloutSlashItems(editor as never),
                ...getKbAiSlashItems(editor as never, aiSlashEnabled),
              ] as ReturnType<typeof getDefaultReactSlashMenuItems>,
              query,
            )
          }
          // Floating-UI placement с auto-flip + shift + size:
          //   - placement bottom-start = дефолт BlockNote (под курсором)
          //   - flip — если внизу нет места, переворачивает наверх
          //   - shift — сдвигает по горизонтали чтобы влезло в viewport
          //   - size — ограничивает высоту менюшки до доступного places
          // Без явных middleware BlockNote использует дефолты, которые
          // НЕ переключают placement когда курсор у нижнего края экрана —
          // меню уезжает за viewport и не видно. См. github issues
          // BlockNote по slash-menu placement.
          floatingUIOptions={{
            useFloatingOptions: {
              placement: "bottom-start",
              middleware: [
                offset(8),
                flip({ padding: 8 }),
                shift({ padding: 8 }),
                size({
                  apply({ availableHeight, elements }) {
                    Object.assign(elements.floating.style, {
                      maxHeight: `${Math.max(120, availableHeight - 8)}px`,
                    });
                  },
                  padding: 8,
                }),
              ],
            },
          }}
        />
      )}
      {(aiSlashEnabled || commentsBundle) && (
        <FormattingToolbarController
          formattingToolbar={() => (
            <FormattingToolbar>
              {/* Дефолтные кнопки (Bold/Italic/Color/Link/...) — без
                  изменений. AI-кнопка + AddComment добавлены в конец,
                  после link/text-align. */}
              {...getFormattingToolbarItems()}
              {aiSlashEnabled && (
                <KbAiFormattingButton aiEnabled={aiSlashEnabled} />
              )}
              {commentsBundle && commentsBundle.canComment && (
                <AddCommentButton key="add-comment" />
              )}
            </FormattingToolbar>
          )}
        />
      )}
      {/* Comments controllers — рендерятся только если bundle передан.
          FloatingComposerController — pop-up «нового комментария» при
          клике на AddCommentButton с выделенным текстом.
          FloatingThreadController — открывает thread при клике по
          существующему comment-mark'у. Дефолтные UI'и из BlockNote'а
          подойдут, дальше можно стилизовать. */}
      {commentsBundle && (
        <>
          <FloatingComposerController />
          <FloatingThreadController />
        </>
      )}
      {renderExtras?.(editor as unknown as BlockNoteEditor)}
    </BlockNoteView>
  );
}

