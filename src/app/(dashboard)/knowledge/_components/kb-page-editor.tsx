"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Cloud, CloudOff, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { saveKbPage } from "@/lib/knowledge/pages";
import { KbBlockNoteEditor } from "@/components/knowledge/blocknote-editor";
import type { KbBlock } from "@/types/knowledge";

const DEBOUNCE_MS = 1500;

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
  initialContent,
  canEdit,
}: KbPageEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [icon, setIcon] = useState(initialIcon ?? "");
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  // Latest values via refs so the debounced save closure always sees
  // them. Mutating refs doesn't trigger re-renders — we just need a
  // stable handle for the timer callback.
  const titleRef = useRef(title);
  const iconRef = useRef(icon);
  const contentRef = useRef<KbBlock[]>(initialContent);
  const plainTextRef = useRef<string>("");

  useEffect(() => {
    titleRef.current = title;
  }, [title]);
  useEffect(() => {
    iconRef.current = icon;
  }, [icon]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setSaveState({ kind: "saving" });
    const { error } = await saveKbPage({
      id: pageId,
      title: titleRef.current.trim() || "Без названия",
      icon: iconRef.current.trim() || null,
      content: contentRef.current,
      plain_text: plainTextRef.current,
    });
    if (error) {
      setSaveState({ kind: "error", message: error });
      toast.error(`Не удалось сохранить: ${error}`);
      return;
    }
    setSaveState({ kind: "saved", at: new Date() });
  }, [pageId]);

  const scheduleSave = useCallback(() => {
    if (!canEdit) return;
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
    <div className="flex flex-col gap-4">
      {/* Status row above the title — small, non-intrusive */}
      <SaveStatus state={saveState} />

      {/* Title + icon row */}
      <div className="flex items-start gap-3">
        <Input
          aria-label="Иконка"
          value={icon}
          onChange={(e) => {
            setIcon(e.target.value);
            scheduleSave();
          }}
          placeholder="📄"
          maxLength={4}
          disabled={!canEdit}
          className="size-12 text-center text-2xl shrink-0 border-transparent
                     hover:border-border focus-visible:border-border"
        />
        <Input
          aria-label="Заголовок страницы"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            scheduleSave();
          }}
          placeholder="Без названия"
          disabled={!canEdit}
          className="h-12 flex-1 border-transparent bg-transparent px-2
                     text-3xl font-semibold tracking-tight shadow-none
                     hover:border-border focus-visible:border-border
                     md:text-3xl"
        />
      </div>

      {/* Editor surface */}
      <KbBlockNoteEditor
        // Remount on page change so BlockNote loads the new doc.
        // (Otherwise its internal state stays anchored to the first mount.)
        key={pageId}
        initialContent={initialContent}
        editable={canEdit}
        onChange={({ content, plainText }) => {
          contentRef.current = content;
          plainTextRef.current = plainText;
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
