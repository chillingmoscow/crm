"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";

import { saveKbPage } from "@/lib/knowledge/pages";
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
import {
  SupabaseThreadStore,
  resolveKbUsers,
} from "@/lib/knowledge/comments-store";
import { useKbPageViewTracker } from "@/lib/knowledge/use-page-view-tracker";
import type { CommentsBundle } from "@/components/knowledge/blocknote-editor";
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
import type { BlockNoteEditor as BlockNoteEditorType } from "@blocknote/core";
import type { KbBlock } from "@/types/knowledge";

// Custom URL scheme used by the BlockNote wrapper to mark uploaded KB
// files (kept in sync with KB_BLOCKNOTE_FILE_SCHEME).
const KB_FILE_SCHEME = "kbfile://";

// Module-level signed-URL cache: BlockNote дёргает resolveFileUrl на
// каждый рендер блока (в т.ч. при resize image). Без кэша мы каждый
// раз минтим новый signed URL → <img src> меняется → браузер заново
// фетчит файл → изображение мигает на 1-2 секунды и страница «прыгает».
// Server signs с TTL 1h (см. DEFAULT_TTL_SECONDS); кэшируем на 50 мин
// чтобы не подойти близко к expiry.
const SIGNED_URL_TTL_MS = 50 * 60 * 1000;
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
function getCachedSignedUrl(storagePath: string): string | null {
  const entry = signedUrlCache.get(storagePath);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    signedUrlCache.delete(storagePath);
    return null;
  }
  return entry.url;
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
  aiSlashEnabled = false,
  canComment = false,
  accountId = null,
  userId = null,
}: KbPageEditorProps) {
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
    };
  }, [pageId, accountId, userId, canEdit, canComment]);

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
  const plainTextRef = useRef<string>("");
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

  // Reset save badge to idle при смене pageId (на случай если
  // module-store держал «Сохранено» от предыдущей страницы).
  useEffect(() => {
    setKbSaveState({ kind: "idle" });
  }, [pageId]);

  // Подогнать высоту title-textarea под content на первый рендер
  // (длинный заголовок занимает 2-3 строки сразу, без мерцания).
  useEffect(() => {
    const ta = titleAreaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [pageId]);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
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
    setKbSaveState({ kind: "saving" });
    const { error } = await saveKbPage({
      id: pageId,
      title: titleRef.current.trim() || "Без названия",
      icon: iconRef.current?.trim() || null,
      icon_color: iconColorRef.current || null,
      content: contentRef.current,
      plain_text: plainTextRef.current,
    });
    if (error) {
      setKbSaveState({ kind: "error", message: error });
      toast.error(`Не удалось сохранить: ${error}`);
      return;
    }
    lastSavedHashRef.current = newHash;
    setKbSaveState({ kind: "saved", at: new Date() });
  }, [pageId]);

  const scheduleSave = useCallback(() => {
    if (!canEdit) return;
    // Cheap pre-check: if nothing changed since the last save, don't
    // even schedule a timer (avoids the «Не сохранено» flash on doc
    // load when BlockNote fires its initial onChange).
    const newHash = snapshotHash(
      titleRef.current,
      iconRef.current,
      iconColorRef.current,
      contentRef.current,
    );
    if (newHash === lastSavedHashRef.current) return;

    setKbSaveState({ kind: "pending" });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void flush();
    }, DEBOUNCE_MS);
  }, [canEdit, flush]);

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
  const renderExtras = useCallback(
    (editor: BlockNoteEditorType) => (
      <>
        <KbEditorRegistrar editor={editor} />
        <KbMentionMenu editor={editor} />
        <KbSideMenuController />
      </>
    ),
    [],
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
              // Sync refs BEFORE scheduleSave so the in-handler hash check
              // sees the latest values (refs are otherwise updated only
              // by useEffect on next render).
              iconRef.current = nextIcon;
              iconColorRef.current = nextColor;
              setIcon(nextIcon);
              setIconColor(nextColor);
              scheduleSave();
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
            // Авто-высота: сначала сбрасываем, иначе scrollHeight
            // растёт безостановочно при backspace.
            const ta = e.currentTarget;
            ta.style.height = "auto";
            ta.style.height = `${ta.scrollHeight}px`;
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
          // юзер не таскал ручкой. overflow-hidden + auto-height в
          // onChange = wrap без скролла.
          className="w-full bg-transparent px-2 -ml-2 py-1 outline-none resize-none overflow-hidden
                     text-[40px] font-extrabold tracking-tight leading-[1.15]
                     placeholder:text-muted-foreground/50"
        />
      </div>

      {/* Editor surface */}
      <KbBlockNoteEditor
        // Remount on page change so BlockNote loads the new doc.
        // (Otherwise its internal state stays anchored to the first mount.)
        key={pageId}
        initialContent={initialContent}
        editable={canEdit}
        customSideMenu
        customSlashMenu
        aiSlashEnabled={aiSlashEnabled}
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
          signedUrlCache.set(storagePath, {
            url: signed,
            expiresAt: Date.now() + SIGNED_URL_TTL_MS,
          });
          return signed;
        }}
        onChange={({ content, plainText }) => {
          contentRef.current = content;
          plainTextRef.current = plainText;
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
