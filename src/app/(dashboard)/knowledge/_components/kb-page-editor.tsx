"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2, Cloud, CloudOff, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { saveKbPage } from "@/lib/knowledge/pages";
import {
  uploadKbAttachment,
  getKbAttachmentSignedUrl,
} from "@/lib/knowledge/attachments";
import { KbIconPicker } from "@/components/knowledge/kb-icon-picker";
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

type SaveState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "error"; message: string };

interface KbPageEditorProps {
  pageId: string;
  initialTitle: string;
  initialIcon: string | null;
  initialIconColor: string | null;
  initialContent: KbBlock[];
  canEdit: boolean;
}

/**
 * KB page editor: borderless title input + emoji input + BlockNote
 * editor with debounced auto-save (1.5s). Save status is surfaced
 * inline next to the breadcrumbs (mounted by the parent server
 * component via a portal-like sibling — see slug page.tsx).
 *
 * Saves go through `saveKbPage` → `kb_save_page` RPC, which atomically
 * updates the row, snapshots a version, and replaces backlinks
 * (migration 052).
 */
export function KbPageEditor({
  pageId,
  initialTitle,
  initialIcon,
  initialIconColor,
  initialContent,
  canEdit,
}: KbPageEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [icon, setIcon] = useState<string | null>(initialIcon);
  const [iconColor, setIconColor] = useState<string | null>(initialIconColor);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  // Latest values via refs so the debounced save closure always sees
  // them. Mutating refs doesn't trigger re-renders — we just need a
  // stable handle for the timer callback.
  const titleRef = useRef(title);
  const iconRef = useRef(icon);
  const iconColorRef = useRef(iconColor);
  const contentRef = useRef<KbBlock[]>(initialContent);
  const plainTextRef = useRef<string>("");

  // Hash of the last successfully-saved (or initial) state. Used to
  // skip no-op saves: BlockNote fires onChange when its document
  // first loads, and our title/icon inputs don't actually change on
  // mount — we don't want to POST identical content back to the server.
  const lastSavedHashRef = useRef<string>(
    snapshotHash(initialTitle, initialIcon, initialIconColor, initialContent),
  );

  // BlockNote fires its first onChange while *loading* the initial
  // document — and at that point the document goes through internal
  // normalization (block IDs assigned, attrs canonicalized), so the
  // hash of `content` differs from what we put in. We treat that
  // first onChange as the new baseline instead of as an edit.
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
      setSaveState((prev) => (prev.kind === "pending" ? { kind: "idle" } : prev));
      return;
    }
    setSaveState({ kind: "saving" });
    const { error } = await saveKbPage({
      id: pageId,
      title: titleRef.current.trim() || "Без названия",
      icon: iconRef.current?.trim() || null,
      icon_color: iconColorRef.current || null,
      content: contentRef.current,
      plain_text: plainTextRef.current,
    });
    if (error) {
      setSaveState({ kind: "error", message: error });
      toast.error(`Не удалось сохранить: ${error}`);
      return;
    }
    lastSavedHashRef.current = newHash;
    setSaveState({ kind: "saved", at: new Date() });
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

    setSaveState({ kind: "pending" });
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
        // Best-effort sync flush — we can't await in cleanup, but the
        // server action itself is fire-and-forget from the browser's
        // perspective once the request leaves.
        void flush();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // beforeunload: warn the user if there are pending edits.
  useEffect(() => {
    if (!canEdit) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (saveState.kind === "pending" || saveState.kind === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [canEdit, saveState.kind]);

  return (
    <div className="flex flex-col gap-3">
      {/* Status row — fixed-height slot so its appearance/disappearance
          doesn't push the editor up/down (avoids visible "screen jump"
          on every save cycle). */}
      <div className="h-5">
        <SaveStatus state={saveState} />
      </div>

      {/* Notion-style header: icon на отдельной строке (большая, слева),
          ниже — title крупным шрифтом, ниже — meta-row с мини-аватаром
          и временем правки. Иконка прижата к левому краю reading-зоны
          через -ml-2 (компенсирует hover-padding picker'а). */}
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
        <Input
          aria-label="Заголовок страницы"
          value={title}
          onChange={(e) => {
            const next = e.target.value;
            // Same sync-ref reasoning as iconRef above.
            titleRef.current = next;
            setTitle(next);
            scheduleSave();
          }}
          placeholder="Без названия"
          disabled={!canEdit}
          // H1-страницы (Notion-like): 48px / 800 / -0.02em / 1.1.
          // Полностью borderless — никакой рамки даже на hover/focus,
          // поле сливается с фоном страницы.
          className="h-auto py-1 border-0 bg-transparent px-2 -ml-2
                     text-[48px] font-extrabold tracking-tight leading-[1.1] shadow-none
                     hover:border-0 focus:border-0 focus-visible:border-0
                     focus-visible:ring-0 focus-visible:outline-none"
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
        renderExtras={(editor) => (
          <>
            <KbMentionMenu editor={editor} />
            <KbSideMenuController />
          </>
        )}
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

function SaveStatus({ state }: { state: SaveState }) {
  if (state.kind === "idle") return null;

  if (state.kind === "pending") {
    return (
      <Badge tone="muted">
        <CloudOff className="size-3.5" />
        Не сохранено
      </Badge>
    );
  }

  if (state.kind === "saving") {
    return (
      <Badge tone="muted">
        <Loader2 className="size-3.5 animate-spin" />
        Сохраняем…
      </Badge>
    );
  }

  if (state.kind === "saved") {
    return (
      <Badge tone="muted">
        <Cloud className="size-3.5" />
        Сохранено · {formatTime(state.at)}
      </Badge>
    );
  }

  return (
    <Badge tone="error">
      <AlertTriangle className="size-3.5" />
      Ошибка сохранения
    </Badge>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "muted" | "error";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-0.5 text-xs",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "error" && "bg-destructive/10 text-destructive",
      )}
    >
      {children}
    </span>
  );
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
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
