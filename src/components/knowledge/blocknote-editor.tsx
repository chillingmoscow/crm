"use client";

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
  FloatingComposerController,
  FloatingThreadController,
  LinkToolbar,
  LinkToolbarController,
} from "@blocknote/react";
import { Info, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { blocksToPlainText } from "@/lib/knowledge/plain-text";
import {
  htmlHasBrokenImg,
  stripBrokenImgInHtml,
} from "@/lib/knowledge/blocks-media";
import { kbCalloutBlock } from "@/components/knowledge/blocks/kb-callout-block";
import { kbPageMentionInlineContent } from "@/components/knowledge/blocks/kb-page-mention";
import { kbStaffMentionInlineContent } from "@/components/knowledge/blocks/kb-staff-mention";
import { KbFloatingComposer } from "@/components/knowledge/blocks/kb-floating-composer";
import { KbFloatingThread } from "@/components/knowledge/blocks/kb-floating-thread";
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
    >
      {customSlashMenu && (
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            // Cast to default-suggestion-item shape: callout-айтемы
            // имеют ту же runtime-форму (title, subtext, group, icon,
            // onItemClick), но TS этого не видит из-за расширенной
            // schema'ы. SuggestionMenuController generic выводится
            // только из default-items.
            //
            // AI-команды НЕ дублируются в slash-меню — все AI-команды
            // (включая блочные «Продолжить» / «Сгенерировать заголовок»)
            // живут в FormattingToolbar.AI-кнопке (см. KbAiFormattingButton).
            filterSuggestionItems(
              [
                ...getDefaultReactSlashMenuItems(editor),
                ...getKbCalloutSlashItems(editor as never),
              ] as ReturnType<typeof getDefaultReactSlashMenuItems>,
              query,
            )
          }
        />
      )}
      {(aiSlashEnabled || commentsBundle) && (
        <FormattingToolbarController
          formattingToolbar={() => (
            <FormattingToolbar>
              {/* Дефолтные кнопки (Bold/Italic/Color/Link/...) +
                  AddCommentButton — последний автоматически включается
                  в getFormattingToolbarItems() когда CommentsExtension
                  подключён. AI-кнопка добавлена в конец. */}
              {...getFormattingToolbarItems()}
              {aiSlashEnabled && (
                <KbAiFormattingButton aiEnabled={aiSlashEnabled} />
              )}
            </FormattingToolbar>
          )}
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
    </BlockNoteView>
  );
}

