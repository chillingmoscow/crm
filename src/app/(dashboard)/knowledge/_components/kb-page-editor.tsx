"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Clock, Loader2, Lock, Pencil, Unlock } from "lucide-react";
import { toast } from "sonner";

import { createKbPage, setKbPageLock } from "@/lib/knowledge/pages";
import { cn } from "@/lib/utils";
import {
  uploadKbAttachment,
  getKbAttachmentSignedUrl,
} from "@/lib/knowledge/attachments";
import {
  getCachedSignedUrl,
  setCachedSignedUrl,
} from "@/lib/knowledge/signed-url-cache";
import { KbIconPicker } from "@/components/knowledge/kb-icon-picker";
import { setKbEditor } from "@/app/(dashboard)/knowledge/_components/kb-editor-store";
import { useKbPageViewTracker } from "@/lib/knowledge/use-page-view-tracker";
import {
  clearKbPageLocalUnlock,
  setKbPageStateOverride,
  useKbPageStateOverride,
} from "@/app/(dashboard)/knowledge/_components/kb-page-state-overrides-store";
import { useKbCommentsBundle } from "@/app/(dashboard)/knowledge/_components/use-kb-comments-bundle";
import { useKbTitleAutoHeight } from "@/app/(dashboard)/knowledge/_components/use-kb-title-auto-height";
import { useKbAutosave } from "@/app/(dashboard)/knowledge/_components/use-kb-autosave";
import { KbMentionResolutionProvider } from "@/components/knowledge/blocks/kb-mention-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
// Dynamic-import — оба компонента статически зависят от @blocknote/react.
// Без SSR-skip бандл /knowledge/[slug] раздуло бы до ~530 kB.
const KbMentionMenu = dynamic(
  () =>
    import("@/app/(dashboard)/knowledge/_components/kb-mention-menu").then(
      (m) => m.KbMentionMenu,
    ),
  { ssr: false, loading: () => null },
);
const KbSideMenuController = dynamic(
  () =>
    import("@/app/(dashboard)/knowledge/_components/kb-side-menu").then(
      (m) => m.KbSideMenuController,
    ),
  { ssr: false, loading: () => null },
);
const KbThreadGutterIndicators = dynamic(
  () =>
    import("@/components/knowledge/blocks/kb-thread-gutter").then(
      (m) => m.KbThreadGutterIndicators,
    ),
  { ssr: false, loading: () => null },
);
import type { BlockNoteEditor as BlockNoteEditorType } from "@blocknote/core";
import type { KbBlock, KbProperty } from "@/types/knowledge";
const KbPageProperties = dynamic(
  () =>
    import("@/app/(dashboard)/knowledge/_components/kb-page-properties").then(
      (m) => m.KbPageProperties,
    ),
  { ssr: false, loading: () => null },
);
// Page-level Comments — Notion-style top-level discussion. Рендерится
// между properties и body. Не зависит от BlockNote ThreadStore (это
// inline-комментарии); работает напрямую c kb_threads (kind='page') +
// kb_comments. Dynamic-import чтобы realtime/composer-deps не висели в
// SSR-bundle страницы.
const KbPageComments = dynamic(
  () =>
    import("@/components/knowledge/page-comments/kb-page-comments").then(
      (m) => m.KbPageComments,
    ),
  { ssr: false, loading: () => null },
);

// Custom URL scheme used by the BlockNote wrapper to mark uploaded KB
// files (kept in sync with KB_BLOCKNOTE_FILE_SCHEME).
const KB_FILE_SCHEME = "kbfile://";

// Signed-URL cache (memory + localStorage, TTL 50 мин) живёт в
// `src/lib/knowledge/signed-url-cache.ts`. Используется в `resolveFileUrl`
// чтобы `<img src>` оставался стабильным между ре-рендерами блоков.

// BlockNote internally references `window` synchronously inside
// useCreateBlockNote — even with "use client" the App Router renders
// client components on the server first for hydration. Skip SSR
// entirely for the editor.
//
// Loading placeholder: an invisible spacer reserving roughly the
// editor's first-paint height so the title above doesn't visibly
// snap when the BlockNote chunk arrives. No border / fill / pulse —
// users shouldn't see a "ghost card" on every page load.
const KbBlockNoteEditor = dynamic(
  () =>
    import("@/components/knowledge/blocknote-editor").then(
      (m) => m.KbBlockNoteEditor,
    ),
  {
    ssr: false,
    loading: () => (
      <div aria-hidden="true" className="min-h-[120px]" />
    ),
  },
);

interface KbPageEditorProps {
  pageId: string;
  initialTitle: string;
  initialIcon: string | null;
  initialIconColor: string | null;
  initialContent: KbBlock[];
  /** Базовый edit-permission БЕЗ учёта lock-state. Lock-state мы
   *  читаем через override-store ниже, чтобы lock-toggle работал
   *  optimistic-but-без router.refresh. effectiveCanEdit =
   *  canEditBase && !(override.locked ?? initialLocked). */
  canEditBase: boolean;
  /** Server-rendered lock-state (`row.locked_at !== null`). Override
   *  сверху может его перебить — см. kb-page-state-overrides-store. */
  initialLocked: boolean;
  /** `kb.lock_pages`: глобально заблокировать/разблокировать страницу. */
  canLock?: boolean;
  /** `kb.create_pages` permission. Если true — slash-меню «/» содержит
   *  пункт «Новая страница», который создаёт вложенный kb_page и
   *  переводит юзера на него. */
  canCreate?: boolean;
  /** AI-команды (`/ai*`) в slash-меню. Двойной gate выше: kb.use_ai
   *  permission + accounts.ai_enabled. Server-action runKbAiCommand
   *  всё равно перепроверит — это UX-слой. */
  aiSlashEnabled?: boolean;
  /** kb.comment_pages permission (миграция 076) — может ли юзер
   *  создавать новые threads. Без права existing comments всё равно
   *  видны (read-only). null/undefined для full read-only режима. */
  canComment?: boolean;
  /** Active account id + current user id — для SupabaseThreadStore.
   *  Server-rendered, чтобы не тянуть auth.getUser() с клиента. */
  accountId?: string | null;
  userId?: string | null;
  /** Имя и аватарка current user — для рендера в кастомном
   *  comment-композере (Notion-style chip с avatar слева). Server-
   *  rendered из той же `profiles`-выборки, что используется для
   *  audit-info-popover'а. */
  currentUserName?: string | null;
  currentUserAvatarUrl?: string | null;
  /** Примерное время чтения в минутах (Sprint D Phase 2 §2.9).
   *  Server-rendered из `kb_pages.plain_text` через
   *  `estimateReadingMinutes`. Рендерим как badge под title-строкой —
   *  Notion-style. null = не показываем (например, в version-history
   *  preview, где badge только засоряет). */
  readingMinutes?: number | null;
  /** Все slug'и, которые сервер фактически проверил при SSR (собранные
   *  через `extractBacklinks` из `row.content`). Любой slug, не
   *  попавший в это множество, считается «свежевставленным» через
   *  `@`-меню уже после SSR-фетча и рендерится как живой. null =
   *  резолвер отключён → все chip'ы legacy-active. */
  checkedMentionSlugs?: string[] | null;
  /** Подмножество `checkedMentionSlugs`, для которых target-страница
   *  лежит в корзине / не существует / недоступна по RLS. ТОЛЬКО эти
   *  chip'ы рендерятся в disabled-варианте (line-through, грей,
   *  тултип). null = резолвер отключён. */
  deletedMentionSlugs?: string[] | null;
  /** Подмножество `deletedMentionSlugs`, которое реально откроется
   *  read-only (страница в корзине, видна caller'у). Эти chip'ы —
   *  кликабельная ссылка (серая+зачёркнутая); остальные deleted
   *  (hard-delete / чужой аккаунт) остаются inert (Codex P2 #334). */
  trashedMentionSlugs?: string[] | null;
  /** Structured page properties — Notion-style typed fields. Рендерятся
   *  между title и content через `<KbPageProperties>`. Save-цикл —
   *  отдельный (saveKbPageProperties), не идёт через scheduleSave. */
  initialProperties?: KbProperty[];
  /** Имя/аватарка автора создания страницы — рендерится chip'ом под
   *  title рядом с reading-time. Заменяет «О странице» dialog,
   *  который был после переезда в ⋯-меню (PR #115). Изменения и
   *  редактор и так есть в footer'е ⋯-меню. */
  authorName?: string | null;
  authorAvatarUrl?: string | null;
}

/**
 * KB page editor: borderless title input + icon picker + BlockNote
 * editor with debounced auto-save (2s).
 *
 * Save state живёт в module-level store (см. kb-save-status.tsx) и
 * рендерится в KB-топбаре (KbSaveStatusBadge). Это ВАЖНО: раньше
 * saveState был useState внутри этого компонента — каждое обновление
 * (pending/saving/saved) перерисовывало BlockNoteView и закрывало
 * формат-toolbar / slash-menu прямо во время выбора. Теперь редактор
 * не реагирует на save-события на уровне React.
 *
 * Saves go through `saveKbPage` → `kb_save_page` RPC, который атомарно
 * обновляет row, snapshot'ит версию и пересчитывает backlinks (миграция
 * 052). revalidatePath намеренно не вызывается (он триггерил RSC-refresh →
 * меняется row.updated_at → key редактора меняется → BlockNote remount).
 *
 * Декомпозиция (PR refactor/kb-page-editor-hooks):
 *   - `useKbCommentsBundle` — ThreadStore + cleanup для realtime-канала.
 *   - `useKbTitleAutoHeight` — CSS field-sizing + JS-rAF fallback.
 *   - `useKbAutosave` — debounced flush, in-flight guard, hash-skip,
 *     tree-overrides, beforeunload, unmount-flush, registerPendingSaveFlush.
 *   - `signed-url-cache` (lib) — двух-уровневый кэш signed URL'ов.
 */
export function KbPageEditor({
  pageId,
  initialTitle,
  initialIcon,
  initialIconColor,
  initialContent,
  canEditBase,
  initialLocked,
  canLock = false,
  canCreate = false,
  aiSlashEnabled = false,
  canComment = false,
  accountId = null,
  userId = null,
  currentUserName = null,
  currentUserAvatarUrl = null,
  readingMinutes = null,
  checkedMentionSlugs = null,
  deletedMentionSlugs = null,
  trashedMentionSlugs = null,
  initialProperties = [],
  authorName = null,
  authorAvatarUrl = null,
}: KbPageEditorProps) {
  const router = useRouter();

  // Sprint D / Phase 1: page-view analytics. Запускаем как только
  // userId известен (= юзер залогинен и в active account). Hook сам
  // обработает route-change через unmount-cleanup и tab-switch через
  // visibilitychange. Без `userId` — не пишем (анонимные сессии не
  // имеют смысла, RPC всё равно требует auth.uid()).
  useKbPageViewTracker({ pageId, enabled: Boolean(userId) });

  // Lock-state читаем через override-store: после клика lock-toggle
  // мы получаем мгновенное обновление UI без router.refresh()'а
  // (который бы re-fetch'ил все 10 запросов в page.tsx + всё в layout).
  // На next-navigation server-данные уже актуальны (revalidatePath
  // на сервере отработал), override становится no-op'ом по equality.
  const stateOverride = useKbPageStateOverride(pageId);
  const globalLocked = stateOverride?.locked ?? initialLocked;
  const localUnlocked = stateOverride?.localUnlocked === true;
  const canEdit = canEditBase && (!globalLocked || localUnlocked);

  // Local unlock действует только для текущего открытия страницы.
  // Global lock override НЕ чистим: после server-action без revalidatePath
  // soft navigation может вернуться к stale RSC payload, а override
  // удерживает свежий lock-state до reload.
  useEffect(() => {
    return () => clearKbPageLocalUnlock(pageId);
  }, [pageId]);

  // CommentsBundle: ThreadStore + resolveUsers + UI-флаги. Хук
  // инкапсулирует useMemo (single instance per page-mount) +
  // cleanup-effect (destroy() освобождает realtime-канал, Sprint D §5).
  const commentsBundle = useKbCommentsBundle({
    pageId,
    accountId,
    userId,
    canEdit,
    canComment,
    currentUserName,
    currentUserAvatarUrl,
  });

  // Реф на title-textarea — для авто-высоты на первый рендер. Хук
  // ниже отвечает за сам resize (CSS field-sizing primary, JS-rAF
  // fallback для старых браузеров).
  const titleAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const { cssFieldSizingSupported } = useKbTitleAutoHeight(titleAreaRef, pageId);

  // Autosave: state (title/icon/iconColor) + refs + debounced flush +
  // in-flight guard + hash-skip + tree-overrides + lifecycle effects
  // (beforeunload, unmount-flush, registerPendingSaveFlush, save-state
  // reset). Подробная семантика — в use-kb-autosave.ts.
  const { title, icon, iconColor, setTitle, commitIcon, commitContent } =
    useKbAutosave({
      pageId,
      commentsBundle,
      canEdit,
      canComment,
      initialTitle,
      initialIcon,
      initialIconColor,
      initialContent,
    });

  const createNestedPage = useCallback(async () => {
    if (!canCreate) return;
    const { slug, error } = await createKbPage({ parent_id: pageId });
    if (error || !slug) {
      toast.error(error ?? "Не удалось создать подстраницу");
      return;
    }
    router.push(`/knowledge/${slug}`);
  }, [canCreate, pageId, router]);

  // Memoized handler для BlockNoteView children — стабильная identity
  // помогает избежать лишних reconciliation-циклов в children-цепочке
  // BlockNoteView (mention/side-menu controller'ы). editor reference
  // стабилен внутри useCreateBlockNote.
  // commentsBundle используется gutter-индикатором — render условно,
  // чтобы хук useExtension(CommentsExtension) не срабатывал на страницах
  // без комментариев.
  const hasComments = commentsBundle !== null;
  const shouldRenderProperties = canEditBase || initialProperties.length > 0;
  const renderExtras = useCallback(
    (editor: BlockNoteEditorType) => (
      <>
        <KbEditorRegistrar editor={editor} />
        <KbMentionMenu editor={editor} />
        <KbSideMenuController editable={canEdit} />
        {hasComments && <KbThreadGutterIndicators />}
      </>
    ),
    [hasComments, canEdit],
  );

  return (
    <div className="flex flex-col gap-3">
      {globalLocked && (
        <KbLockedPill
          pageId={pageId}
          canEditBase={canEditBase}
          canLock={canLock}
          localUnlocked={localUnlocked}
        />
      )}
      {/* Notion-style header: icon на отдельной строке, ниже title. */}
      <div className="flex flex-col gap-2">
        <div className="-ml-2">
          <KbIconPicker
            value={icon}
            color={iconColor}
            disabled={!canEdit}
            triggerSize={64}
            onChange={({ icon: nextIcon, color: nextColor }) => {
              // commitIcon: sync refs + state + IMMEDIATE flush (bypass
              // 2-сек debounce). Юзер ждёт мгновенной персистентности
              // и обновления tree-иконки в sidebar.
              commitIcon(nextIcon, nextColor);
            }}
          />
        </div>
        {/* <textarea> вместо <input>, чтобы длинные заголовки переносились
            на новую строку, а не обрезались. Высота растёт через CSS
            `field-sizing: content` (primary) или JS-rAF fallback в
            useKbTitleAutoHeight. Enter перехватываем — title должен быть
            однострочным смыслово, но визуально может занимать несколько
            строк. */}
        <textarea
          ref={titleAreaRef}
          aria-label="Заголовок страницы"
          rows={1}
          value={title}
          onChange={(e) => {
            const next = e.target.value;
            setTitle(next);
            // Auto-height: primary — CSS `field-sizing: content`,
            // fallback — defer JS-resize в rAF чтобы избежать sync
            // forced reflow в hot path keystroke'а.
            if (!cssFieldSizingSupported) {
              const ta = e.currentTarget;
              requestAnimationFrame(() => {
                ta.style.height = "auto";
                ta.style.height = `${ta.scrollHeight}px`;
              });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
            }
          }}
          placeholder="Без названия"
          disabled={!canEdit}
          // H1-страницы: 40px / 800 / -0.02em / 1.15. resize-none чтобы
          // юзер не таскал ручкой. overflow-hidden + field-sizing
          // (CSS-уровневый auto-grow) = wrap без скролла без JS-reflow.
          style={{
            // TS DOM lib пока не знает о field-sizing CSS-prop'е (Baseline 2024).
            // Объект-стиль — единственный способ передать его без casting'а
            // к 'as any' прямо в className. В браузерах без поддержки —
            // значение игнорируется, далее работает rAF-fallback.
            fieldSizing: "content",
          } as React.CSSProperties & { fieldSizing?: string }}
          className="w-full bg-transparent px-2 -ml-2 py-1 outline-none resize-none overflow-hidden
                     text-[40px] font-extrabold tracking-tight leading-[1.15]
                     placeholder:text-muted-foreground/50
                     disabled:opacity-100 disabled:text-foreground"
        />
        {/* Header-meta line: автор + reading-time. Notion-style: тонкая
            строка под title с компактными chip'ами. authorName/
            authorAvatarUrl приходят с server-render'а, пустые →
            chip скрывается. readingMinutes тоже опционален. */}
        {(readingMinutes !== null && readingMinutes !== undefined) ||
        authorName ? (
          <div className="px-2 -ml-2 flex items-center gap-3 flex-wrap">
            {authorName && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                {authorAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={authorAvatarUrl}
                    alt=""
                    className="size-4 rounded-full object-cover bg-muted shrink-0"
                  />
                ) : (
                  <span className="size-4 rounded-full bg-muted text-muted-foreground inline-flex items-center justify-center text-[8px] font-semibold shrink-0">
                    {authorName
                      .split(" ")
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((p) => p[0]?.toUpperCase() ?? "")
                      .join("") || "?"}
                  </span>
                )}
                <span>{authorName}</span>
              </span>
            )}
            {readingMinutes !== null && readingMinutes !== undefined && (
              <span
                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                data-tip={`Примерное время чтения: ${readingMinutes} мин`}
              >
                <Clock className="size-3.5" />
                <span className="tabular-nums">
                  ≈ {readingMinutes} мин чтения
                </span>
              </span>
            )}
          </div>
        ) : null}
      </div>

      {/* Properties panel — Notion-style key-value fields, рендерится
          между title и content. Свой save-цикл (saveKbPageProperties),
          не идёт через scheduleSave editor'а — независимый UPDATE
          колонки `properties`. */}
      {shouldRenderProperties && (
        <KbPageProperties
          targetId={pageId}
          mode="page"
          initialProperties={initialProperties}
          canEdit={canEdit}
        />
      )}

      {/* Page-level Comments (Notion-style discussion). Между properties
          и body — соответствует Notion'овскому расположению. Render-gate
          внутри: если у юзера НЕТ kb.comment_pages И комментариев нет —
          компонент не рендерится. inline-comments (через ThreadStore)
          работают независимо в KbBlockNoteEditor ниже. */}
      {accountId && userId && (
        <KbPageComments
          pageId={pageId}
          userId={userId}
          currentUserName={currentUserName}
          currentUserAvatarUrl={currentUserAvatarUrl}
          canComment={canComment}
          canEdit={canEdit}
        />
      )}

      {/* Editor surface — обёрнут в KbMentionResolutionProvider, чтобы
          render kbPageMention chip'а мог отличить slug, ведущий на
          живую страницу, от slug'а в корзине / удалённого. Provider
          живёт внутри useContext-чтения, выполняемого Tiptap-React
          NodeViewRenderer'ом — context propagation работает обычным
          образом, потому что @blocknote/react рендерит inline-views в
          том же React-tree (через NodeViewWrapper). */}
      <KbMentionResolutionProvider
        checkedSlugs={checkedMentionSlugs}
        deletedSlugs={deletedMentionSlugs}
        trashedSlugs={trashedMentionSlugs}
      >
        <KbBlockNoteEditor
          // Remount on page change so BlockNote loads the new doc.
          // (Otherwise its internal state stays anchored to the first mount.)
          key={pageId}
          pageId={pageId}
          initialContent={initialContent}
          editable={canEdit}
          customSideMenu
          customSlashMenu
          aiSlashEnabled={aiSlashEnabled}
          onCreateNestedPage={canCreate ? createNestedPage : undefined}
          commentsBundle={commentsBundle}
          renderExtras={renderExtras}
          uploadFile={async (file) => {
            const result = await uploadKbAttachment({
              pageId,
              file,
              name: file.name,
              mime_type: file.type || "application/octet-stream",
            });
            if (result.error || !result.storage_path) {
              toast.error(`Не удалось загрузить файл: ${result.error}`);
              // Throwing makes BlockNote show its own upload-failed state.
              throw new Error(result.error ?? "upload failed");
            }
            // Store storage_path inside our custom scheme so it survives
            // round-trip through jsonb. resolveFileUrl below mints a fresh
            // signed URL on render.
            return `${KB_FILE_SCHEME}${result.storage_path}`;
          }}
          resolveFileUrl={async (url) => {
            if (!url.startsWith(KB_FILE_SCHEME)) return url;
            const storagePath = url.slice(KB_FILE_SCHEME.length);
            // Cache hit → отдаём тот же signed URL что и в прошлый раз.
            // Для <img> это означает identical src → no re-fetch → no flash
            // при resize/перерендере блока.
            const cached = getCachedSignedUrl(storagePath);
            if (cached) return cached;
            // Retry-once на transient pool-timeout'ах. На странице с 10+
            // изображениями BlockNote дёргает resolveFileUrl параллельно
            // на каждый блок → 10 одновременных DB-query на pool=20.
            // Половина может упасть на «pool exhausted» → user видит
            // «BlockNote image» broken-icon вместо картинки. Backoff
            // 200мс перед retry даёт pool разгрузиться. На постоянной
            // ошибке (file deleted, RLS reject) обе попытки упадут
            // одинаково — fallback на kbfile:// → broken-icon как и раньше.
            let attempt = await getKbAttachmentSignedUrl(storagePath);
            if (attempt.error || !attempt.url) {
              await new Promise((r) => setTimeout(r, 200));
              attempt = await getKbAttachmentSignedUrl(storagePath);
            }
            const { url: signed, error } = attempt;
            if (error || !signed) {
              // Fall back to the kbfile:// URL — browser will show a
              // broken-image icon, which is the right signal that
              // something went wrong server-side.
              return url;
            }
            setCachedSignedUrl(storagePath, signed);
            return signed;
          }}
          onChange={({ content }) => {
            // commitContent: ref + first-event-baseline-guard + scheduleSave.
            commitContent(content);
          }}
        />
      </KbMentionResolutionProvider>
    </div>
  );
}

function KbLockedPill({
  pageId,
  canEditBase,
  canLock,
  localUnlocked,
}: {
  pageId: string;
  canEditBase: boolean;
  canLock: boolean;
  localUnlocked: boolean;
}) {
  const [unlockPending, setUnlockPending] = useState(false);
  const hasActions = canEditBase || canLock;
  const pillClassName = cn(
    "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
    localUnlocked
      ? "border border-amber-300/70 bg-amber-50 text-amber-900 hover:bg-amber-100 data-[state=open]:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200 dark:hover:bg-amber-500/20 dark:data-[state=open]:bg-amber-500/20"
      : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground",
  );
  const PillIcon = localUnlocked ? Unlock : Lock;
  const pillLabel = localUnlocked ? "Разблокировано" : "Заблокировано";

  const unlockForMe = () => {
    setKbPageStateOverride(pageId, { localUnlocked: true });
  };

  const lockForMe = () => {
    setKbPageStateOverride(pageId, { localUnlocked: false });
  };

  const unlockForEveryone = async () => {
    setKbPageStateOverride(pageId, { locked: false, localUnlocked: false });
    setUnlockPending(true);
    const { error } = await setKbPageLock({ pageId, locked: false });
    setUnlockPending(false);
    if (error) {
      setKbPageStateOverride(pageId, {
        locked: true,
        localUnlocked: false,
      });
      toast.error(`Не удалось разблокировать страницу: ${error}`);
    }
  };

  if (!hasActions) {
    return (
      <div className="px-2 -ml-2">
        <span className={pillClassName}>
          <PillIcon className="size-4" />
          <span>{pillLabel}</span>
        </span>
      </div>
    );
  }

  if (localUnlocked) {
    return (
      <div className="px-2 -ml-2">
        <button
          type="button"
          className={pillClassName}
          aria-label="Снова заблокировать страницу для себя"
          onClick={lockForMe}
        >
          <PillIcon className="size-4" />
          <span>{pillLabel}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="px-2 -ml-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={pillClassName}
            aria-label="Страница заблокирована"
          >
            <PillIcon className="size-4" />
            <span>{pillLabel}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="w-[260px] rounded-[10px] p-1.5"
        >
          {canEditBase && !localUnlocked && (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                unlockForMe();
              }}
              className="gap-3 rounded-md px-2.5 py-2 text-[15px]"
            >
              <Pencil className="size-4 shrink-0" />
              <span>Редактировать</span>
            </DropdownMenuItem>
          )}
          {canLock && (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                if (!unlockPending) void unlockForEveryone();
              }}
              disabled={unlockPending}
              className="gap-3 rounded-md px-2.5 py-2 text-[15px]"
            >
              {unlockPending ? (
                <Loader2 className="size-4 shrink-0 animate-spin" />
              ) : (
                <Unlock className="size-4 shrink-0" />
              )}
              <span>Разблокировать</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Регистрирует editor instance в module-store на mount + очищает на
 *  unmount. Без этого Undo/Redo кнопки в KB-топбаре не знают, к какому
 *  редактору обращаться (топбар рендерится в server-side слоте, далеко
 *  от editor mount-point). См. kb-editor-store.ts. */
function KbEditorRegistrar({ editor }: { editor: BlockNoteEditorType }) {
  useEffect(() => {
    setKbEditor(editor);
    return () => {
      setKbEditor(null);
    };
  }, [editor]);
  return null;
}
