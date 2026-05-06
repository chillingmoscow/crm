"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Clock } from "lucide-react";
import { toast } from "sonner";

import { createKbPage, saveKbPage } from "@/lib/knowledge/pages";
import { registerPendingSaveFlush } from "@/lib/knowledge/pending-saves";
import { blocksToPlainText } from "@/lib/knowledge/plain-text";
import {
  uploadKbAttachment,
  getKbAttachmentSignedUrl,
} from "@/lib/knowledge/attachments";
import { KbIconPicker } from "@/components/knowledge/kb-icon-picker";
import {
  getKbSaveState,
  setKbSaveState,
} from "@/app/(dashboard)/knowledge/_components/kb-save-status";
import { setKbEditor } from "@/app/(dashboard)/knowledge/_components/kb-editor-store";
import { setKbTreeOverride } from "@/app/(dashboard)/knowledge/_components/kb-tree-overrides-store";
import {
  SupabaseThreadStore,
  resolveKbUsers,
} from "@/lib/knowledge/comments-store";
import { useKbPageViewTracker } from "@/lib/knowledge/use-page-view-tracker";
import type { CommentsBundle } from "@/components/knowledge/blocknote-editor";
import { KbMentionResolutionProvider } from "@/components/knowledge/blocks/kb-mention-context";
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
import { KbPageProperties } from "@/app/(dashboard)/knowledge/_components/kb-page-properties";

// Custom URL scheme used by the BlockNote wrapper to mark uploaded KB
// files (kept in sync with KB_BLOCKNOTE_FILE_SCHEME).
const KB_FILE_SCHEME = "kbfile://";

// Module-level signed-URL cache: BlockNote дёргает resolveFileUrl на
// каждый рендер блока (в т.ч. при resize image). Без кэша мы каждый
// раз минтим новый signed URL → <img src> меняется → браузер заново
// фетчит файл → изображение мигает на 1-2 секунды и страница «прыгает».
//
// Кэш двух-уровневый:
//   1. Memory Map (горячий, в пределах текущей mount'а).
//   2. localStorage (выживает page-reload). Без него reload страницы
//      минтит свежий signed URL → src меняется → браузер не находит в
//      cache → re-fetch → image «мигает» при каждом перезагрузе. С
//      localStorage URL стабилен в пределах TTL → 304/disk-cache hit.
//
// Server signs с TTL 1h (см. DEFAULT_TTL_SECONDS); кэшируем на 50 мин
// чтобы не подойти близко к expiry.
const SIGNED_URL_TTL_MS = 50 * 60 * 1000;
const SIGNED_URL_LS_PREFIX = "kb-signed-url:";
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

function getCachedSignedUrl(storagePath: string): string | null {
  const entry = signedUrlCache.get(storagePath);
  if (entry && entry.expiresAt > Date.now()) return entry.url;
  if (entry) signedUrlCache.delete(storagePath);

  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SIGNED_URL_LS_PREFIX + storagePath);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { url?: string; expiresAt?: number };
    if (
      typeof parsed.url !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt < Date.now()
    ) {
      window.localStorage.removeItem(SIGNED_URL_LS_PREFIX + storagePath);
      return null;
    }
    // Промоутим в memory чтобы следующий вызов не дёргал localStorage.
    signedUrlCache.set(storagePath, {
      url: parsed.url,
      expiresAt: parsed.expiresAt,
    });
    return parsed.url;
  } catch {
    return null;
  }
}

function setCachedSignedUrl(storagePath: string, url: string): void {
  const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
  signedUrlCache.set(storagePath, { url, expiresAt });
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SIGNED_URL_LS_PREFIX + storagePath,
      JSON.stringify({ url, expiresAt }),
    );
  } catch {
    // QuotaExceeded / private mode — tolerable, memory cache remains.
  }
}

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

const DEBOUNCE_MS = 2000;

interface KbPageEditorProps {
  pageId: string;
  initialTitle: string;
  initialIcon: string | null;
  initialIconColor: string | null;
  initialContent: KbBlock[];
  canEdit: boolean;
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
 * Saves go through `saveKbPage` → `kb_save_page` RPC, который
 * атомарно обновляет row, snapshot'ит версию и пересчитывает
 * backlinks (миграция 052). revalidatePath намеренно не вызывается
 * (он триггерил RSC-refresh → меняется row.updated_at → key редактора
 * меняется → BlockNote remount).
 */
export function KbPageEditor({
  pageId,
  initialTitle,
  initialIcon,
  initialIconColor,
  initialContent,
  canEdit,
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
  // SupabaseThreadStore + resolveUsers — single instance per page mount.
  // Recreate если pageId меняется (но key={pageId} в parent уже это
  // делает — вся компонента remount'ится). useMemo с deps на pageId/
  // accountId/userId — на случай если в будущем remount уберут.
  //
  // Если у юзера НЕТ `kb.comment_pages` (canComment=false) — bundle
  // полностью null. CommentsExtension не подключается, BlockNote
  // не показывает thread-UI / AddCommentButton / ничего comment-related.
  // Раньше bundle создавался даже без права → DefaultThreadStoreAuth
  // считал юзера 'editor', UI показывал кнопки → click → RLS reject
  // в runtime'е, плохой UX. См. Codex #54 P2.
  //
  // Для read-only-просмотра уже-existing-thread'ов hostess/waiter'у —
  // нужна отдельная UX-итерация (рендерить треды БЕЗ ability добавлять).
  // На MVP — full off.
  const commentsBundle: CommentsBundle | null = useMemo(() => {
    if (!accountId || !userId) return null;
    if (!canComment) return null;
    return {
      threadStore: new SupabaseThreadStore({
        pageId,
        accountId,
        userId,
        // 'editor' role в DefaultThreadStoreAuth — может удалять
        // чужие comments / threads. Для KB editor === тот, кто
        // может править страницу. Для не-editor (commenter)
        // canDeleteComment ограничен self-only.
        isEditor: canEdit,
      }),
      resolveUsers: resolveKbUsers,
      canComment,
      currentUserName,
      currentUserAvatarUrl,
    };
  }, [
    pageId,
    accountId,
    userId,
    canEdit,
    canComment,
    currentUserName,
    currentUserAvatarUrl,
  ]);

  // Sprint D Phase 5: thread-store держит Realtime-канал. Без unsubscribe
  // на unmount канал утекает (и сервер продолжает броадкаст-ить даже
  // после route-change'а). useEffect с deps на bundle-instance —
  // когда useMemo пересоздаёт store (смена pageId), cleanup старого
  // запускается до новой подписки.
  useEffect(() => {
    if (!commentsBundle) return;
    const store = commentsBundle.threadStore;
    return () => {
      if (store instanceof SupabaseThreadStore) {
        store.destroy();
      }
    };
  }, [commentsBundle]);

  const [title, setTitle] = useState(initialTitle);
  const [icon, setIcon] = useState<string | null>(initialIcon);
  const [iconColor, setIconColor] = useState<string | null>(initialIconColor);

  // Latest values via refs so the debounced save closure always sees
  // them. Mutating refs doesn't trigger re-renders — we just need a
  // stable handle for the timer callback.
  const titleRef = useRef(title);
  const iconRef = useRef(icon);
  const iconColorRef = useRef(iconColor);
  const contentRef = useRef<KbBlock[]>(initialContent);
  // Реф на title-textarea — нужен для авто-высоты на первый рендер
  // (после mount initialTitle уже занимает >1 строку для длинных).
  const titleAreaRef = useRef<HTMLTextAreaElement | null>(null);

  // Hash of the last successfully-saved (or initial) state. Used to
  // skip no-op saves: BlockNote fires onChange when its document
  // first loads, and our title/icon inputs don't actually change on
  // mount — we don't want to POST identical content back to the server.
  const lastSavedHashRef = useRef<string>(
    snapshotHash(initialTitle, initialIcon, initialIconColor, initialContent),
  );

  // Snapshot значений, которые видны в KB-tree (sidebar): title + icon
  // + iconColor. После успешного save'а сравниваем с текущими — если
  // изменились, push'им оверрайд в client-side `kb-tree-overrides-store`,
  // чтобы KbTreeNav сразу нарисовал новую иконку/название без
  // RSC-refresh'а. Раньше тут был `router.refresh()` — он работал, но
  // визуально перезагружал страницу (топбар мигал, editor получал
  // свежие props). Client-side override даёт мгновенный update без
  // network-roundtrip'а; на следующей навигации server-данные уже
  // содержат свежее значение, override становится no-op.
  const lastTreeSnapshotRef = useRef<{
    title: string;
    icon: string;
    iconColor: string;
  }>({
    title: initialTitle,
    icon: initialIcon ?? "",
    iconColor: initialIconColor ?? "",
  });

  // BlockNote fires its first onChange while *loading* the initial
  // document — и в этот момент внутренняя нормализация (block id,
  // canonicalize attrs) меняет hash относительно того, что мы передали.
  // Первый onChange принимаем как baseline, не как edit.
  const isFirstEditorEventRef = useRef(true);

  useEffect(() => {
    titleRef.current = title;
  }, [title]);
  useEffect(() => {
    iconRef.current = icon;
  }, [icon]);
  useEffect(() => {
    iconColorRef.current = iconColor;
  }, [iconColor]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // In-flight-guard: блокирует overlapping flush'и. Если save уже летит,
  // следующий scheduleSave перезапустит timer на 2 сек после возврата
  // — finally-clause очищает inFlight; если за время save'а появились
  // новые правки, debounced-timer догонит их следующим circle'ом.
  // Без guard'а медленный save (>2 сек) приводил к одновременным
  // POST'ам и стабильно «висящему» бейджу «Сохраняем…».
  const inFlightRef = useRef(false);

  // Reset save badge to idle при смене pageId (на случай если
  // module-store держал «Сохранено» от предыдущей страницы).
  useEffect(() => {
    setKbSaveState({ kind: "idle" });
  }, [pageId]);

  // Auto-height для title-textarea. Primary path — CSS `field-sizing:
  // content` (Chrome 123+ / Safari 17.4+); textarea сам растёт под
  // содержимое без JS. Fallback ниже — JS height-set, но через rAF и
  // только когда CSS не поддерживается, чтобы не делать forced reflow
  // на каждом keystroke (раньше это был hot path: setHeight("auto") →
  // read scrollHeight → setHeight(px) — два sync-write'а с layout-
  // read'ом между ними).
  const cssFieldSizingSupported = useMemo(() => {
    if (typeof CSS === "undefined" || typeof CSS.supports !== "function")
      return false;
    return CSS.supports("field-sizing", "content");
  }, []);
  useEffect(() => {
    if (cssFieldSizingSupported) return;
    const ta = titleAreaRef.current;
    if (!ta) return;
    let raf = 0;
    const fit = () => {
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
    };
    raf = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(raf);
  }, [pageId, cssFieldSizingSupported]);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // In-flight-guard: уже идёт save → не запускаем второй параллельно.
    // Если за время save'а появились новые правки, очередной scheduleSave
    // в onChange (или title-input) перезапустит debounce-timer и догонит
    // их следующим циклом.
    if (inFlightRef.current) return;
    const newHash = snapshotHash(
      titleRef.current,
      iconRef.current,
      iconColorRef.current,
      contentRef.current,
    );
    if (newHash === lastSavedHashRef.current) {
      // Nothing actually changed — skip the network round-trip.
      const cur = getKbSaveState();
      if (cur.kind === "pending") setKbSaveState({ kind: "idle" });
      return;
    }
    inFlightRef.current = true;
    try {
      // Перед save'ом — снимаем актуальные comment-mark позиции из PM-
      // дока в kb_threads.metadata. BN strip'ает comment-марки при
      // сериализации в block-content, поэтому позиции — единственный
      // способ восстановить их при reload'е (см. comments-store.ts
      // «Position-persistence для comment-mark'ов»). Fire-and-forget:
      // failures логируются внутри, но не блокируют save.
      if (commentsBundle) {
        const store = commentsBundle.threadStore as unknown as {
          captureCommentMarkPositions?: () => Promise<void>;
        };
        if (typeof store.captureCommentMarkPositions === "function") {
          void store.captureCommentMarkPositions().catch((err) => {
            console.warn("[kb] captureCommentMarkPositions failed", err);
          });
        }
      }
      const plainText = blocksToPlainText(contentRef.current);
      setKbSaveState({ kind: "saving" });
      const { error } = await saveKbPage({
        id: pageId,
        title: titleRef.current.trim() || "Без названия",
        icon: iconRef.current?.trim() || null,
        icon_color: iconColorRef.current || null,
        content: contentRef.current,
        plain_text: plainText,
      });
      if (error) {
        setKbSaveState({ kind: "error", message: error });
        toast.error(`Не удалось сохранить: ${error}`);
        return;
      }
      lastSavedHashRef.current = newHash;

      // Tree-relevant fields (title/icon/iconColor) изменились → push'им
      // оверрайд в client-side store. KbTreeNav читает оверрайд поверх
      // server-данных и сразу рендерит новую иконку. Никакого RSC-refresh'а
      // — страница не «прыгает». На следующей навигации server-getKbTree()
      // вернёт уже свежие значения, override станет no-op.
      // Normalized title — то же, что persists `saveKbPage` выше
      // (`titleRef.current.trim() || "Без названия"`). Codex P2 на PR
      // #134: раньше override писал raw-textarea-значение (с trailing-
      // spaces или пустой строкой), а server сохранял normalized-форму
      // → tree-сайдбар показывал «Без названия» по-разному с editor'ом
      // до next reload'а. Используем одинаковую нормализацию в обеих
      // ветках, чтобы override всегда matched persisted-значение.
      const normalizedTitle = titleRef.current.trim() || "Без названия";
      const prevTree = lastTreeSnapshotRef.current;
      const treeChanged =
        prevTree.title !== normalizedTitle ||
        prevTree.icon !== (iconRef.current ?? "") ||
        prevTree.iconColor !== (iconColorRef.current ?? "");
      if (treeChanged) {
        lastTreeSnapshotRef.current = {
          title: normalizedTitle,
          icon: iconRef.current ?? "",
          iconColor: iconColorRef.current ?? "",
        };
        setKbTreeOverride(pageId, {
          title: normalizedTitle,
          icon: iconRef.current ?? null,
          iconColor: iconColorRef.current ?? null,
        });
      }

      setKbSaveState({ kind: "saved", at: new Date() });
    } finally {
      inFlightRef.current = false;
    }
  }, [pageId, commentsBundle]);

  // Allow scheduleSave когда:
  //   • canEdit (обычный editable-режим), либо
  //   • canComment (locked-страница, на которой comment-mark всё ещё
  //     можно добавить — saveKbPage routes на kb_save_page_comment_only).
  const canSave = canEdit || canComment;
  const scheduleSave = useCallback(() => {
    if (!canSave) return;
    setKbSaveState({ kind: "pending" });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void flush();
    }, DEBOUNCE_MS);
  }, [canSave, flush]);

  const createNestedPage = useCallback(async () => {
    if (!canCreate) return;
    const { slug, error } = await createKbPage({ parent_id: pageId });
    if (error || !slug) {
      toast.error(error ?? "Не удалось создать подстраницу");
      return;
    }
    router.push(`/knowledge/${slug}`);
  }, [canCreate, pageId, router]);

  // Flush on unmount so unsaved edits don't get lost on navigation.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        // Best-effort sync flush — мы не можем await в cleanup, но
        // сам server action — fire-and-forget с точки зрения браузера.
        void flush();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register flush в pending-saves registry: lock-toggle / другие
  // action'ы, которые меняют backend-state атомарно с edit'ами,
  // вызывают `flushAllPendingSaves()` и ждут пока debounced-save
  // долетит до сервера. См. Codex #65 P2.
  useEffect(() => {
    if (!canSave) return;
    return registerPendingSaveFlush(flush);
  }, [canSave, flush]);

  // beforeunload: warn the user if there are pending edits. Читаем
  // state синхронно из module-store — без подписки, чтобы не вызывать
  // re-render при каждом save-tick'е.
  useEffect(() => {
    if (!canEdit) return;
    const handler = (e: BeforeUnloadEvent) => {
      const k = getKbSaveState().kind;
      if (k === "pending" || k === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [canEdit]);

  // Memoized handler для BlockNoteView children — стабильная identity
  // помогает избежать лишних reconciliation-циклов в children-цепочке
  // BlockNoteView (mention/side-menu controller'ы). editor reference
  // стабилен внутри useCreateBlockNote.
  // commentsBundle is used by gutter indicator only — render conditionally
  // so the hooks inside (useExtension(CommentsExtension)) don't fire on
  // pages where comments aren't loaded.
  const hasComments = commentsBundle !== null;
  const renderExtras = useCallback(
    (editor: BlockNoteEditorType) => (
      <>
        <KbEditorRegistrar editor={editor} />
        <KbMentionMenu editor={editor} />
        <KbSideMenuController />
        {hasComments && <KbThreadGutterIndicators />}
      </>
    ),
    [hasComments],
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Notion-style header: icon на отдельной строке, ниже title. */}
      <div className="flex flex-col gap-2">
        <div className="-ml-2">
          <KbIconPicker
            value={icon}
            color={iconColor}
            disabled={!canEdit}
            triggerSize={64}
            onChange={({ icon: nextIcon, color: nextColor }) => {
              // Sync refs BEFORE flush so the in-handler hash check
              // sees the latest values (refs are otherwise updated только
              // useEffect'ом на следующем render'е).
              iconRef.current = nextIcon;
              iconColorRef.current = nextColor;
              setIcon(nextIcon);
              setIconColor(nextColor);
              // Icon — single-click action, юзер ждёт мгновенной
              // персистентности (и обновления tree-иконки в sidebar).
              // Bypass'им 2-сек debounce и flush'им сразу. flush сам
              // выставит "saving" → "saved" и сам дёрнет
              // router.refresh() для tree-relevant полей.
              void flush();
            }}
          />
        </div>
        {/* <textarea> вместо <input>, чтобы длинные заголовки
            переносились на новую строку, а не обрезались. Высота
            растёт под содержимое через onInput → scrollHeight. Enter
            мы перехватываем и блокируем — title должен быть однострочным
            смыслово, но визуально может занимать несколько строк. */}
        <textarea
          ref={titleAreaRef}
          aria-label="Заголовок страницы"
          rows={1}
          value={title}
          onChange={(e) => {
            const next = e.target.value;
            titleRef.current = next;
            setTitle(next);
            // Auto-height: primary — CSS `field-sizing: content`,
            // fallback (старые браузеры) — defer JS-resize в rAF
            // чтобы избежать sync forced reflow в hot path keystroke'а.
            if (!cssFieldSizingSupported) {
              const ta = e.currentTarget;
              requestAnimationFrame(() => {
                ta.style.height = "auto";
                ta.style.height = `${ta.scrollHeight}px`;
              });
            }
            scheduleSave();
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
          // [field-sizing:content] — Tailwind arbitrary value; в
          // браузерах без поддержки этого CSS-свойства — игнорируется,
          // далее работает rAF-fallback в onChange + useEffect.
          style={{
            // TS DOM lib пока не знает о field-sizing CSS-prop'е (Baseline 2024).
            // Объект-стиль — единственный способ передать его без casting'а
            // к 'as any' прямо в className. Чисто строковое значение, рантайм-
            // безопасно даже в старых браузерах (просто игнорируется).
            fieldSizing: "content",
          } as React.CSSProperties & { fieldSizing?: string }}
          className="w-full bg-transparent px-2 -ml-2 py-1 outline-none resize-none overflow-hidden
                     text-[40px] font-extrabold tracking-tight leading-[1.15]
                     placeholder:text-muted-foreground/50"
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
                title={`Примерное время чтения: ${readingMinutes} мин`}
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
      <KbPageProperties
        targetId={pageId}
        mode="page"
        initialProperties={initialProperties}
        canEdit={canEdit}
      />

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
      >
      <KbBlockNoteEditor
        // Remount on page change so BlockNote loads the new doc.
        // (Otherwise its internal state stays anchored to the first mount.)
        key={pageId}
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
          const { url: signed, error } = await getKbAttachmentSignedUrl(storagePath);
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
          contentRef.current = content;
          if (isFirstEditorEventRef.current) {
            // BlockNote's normalization pass — adopt the result as our
            // baseline so subsequent diffs are honest.
            isFirstEditorEventRef.current = false;
            lastSavedHashRef.current = snapshotHash(
              titleRef.current,
              iconRef.current,
              iconColorRef.current,
              content,
            );
            return;
          }
          scheduleSave();
        }}
      />
      </KbMentionResolutionProvider>
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

/** Cheap fingerprint of (title, icon, color, content) for change detection.
 * JSON.stringify is good enough at our doc sizes (≤ ~100 KB jsonb).
 * If a page balloons past that we can swap for a streaming hash. */
function snapshotHash(
  title: string,
  icon: string | null,
  iconColor: string | null,
  content: KbBlock[],
): string {
  return JSON.stringify([title, icon ?? "", iconColor ?? "", content]);
}
