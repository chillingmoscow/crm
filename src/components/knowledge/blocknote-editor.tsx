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
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { Info, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { blocksToPlainText } from "@/lib/knowledge/plain-text";
import { kbCalloutBlock } from "@/components/knowledge/blocks/kb-callout-block";

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
  className?: string;
};

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

  const editor = useCreateBlockNote({
    schema,
    initialContent: initial as never,
    uploadFile: stableUploadFile,
    resolveFileUrl: stableResolveFileUrl,
    dictionary,
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
    >
      {customSlashMenu && (
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            filterSuggestionItems(
              [
                ...getDefaultReactSlashMenuItems(editor),
                ...getKbCalloutSlashItems(editor as never),
              ],
              query,
            )
          }
        />
      )}
      {renderExtras?.(editor as unknown as BlockNoteEditor)}
    </BlockNoteView>
  );
}

