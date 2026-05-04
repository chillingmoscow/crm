"use client";

import { useEffect, useRef, useState } from "react";
import { ThreadsSidebar, useExtension } from "@blocknote/react";
import { CommentsExtension } from "@blocknote/core/comments";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  setKbThreadsSidebarOpen,
  useKbThreadsSidebarOpen,
} from "@/app/(dashboard)/knowledge/_components/kb-threads-sidebar-store";

/**
 * Sidebar со списком всех тредов страницы (Notion / Google-Docs-style
 * «Show All Comments»). Использует готовый `ThreadsSidebar` из
 * `@blocknote/react` — он сам читает наш SupabaseThreadStore через
 * extension-context'ы и рендерит rows с filter / sort.
 *
 * Должен монтироваться внутри `BlockNoteView` (renderExtras) — иначе
 * BN-extension hooks не увидят editor-context.
 *
 * Layout: fixed right pane, top чуть ниже header'а, height — до низа
 * viewport'а. На wide-экранах сидит в пустой области справа от
 * 760px-editor'а; на узких — overlay'ит часть страницы (acceptable
 * для MVP, никаких scroll-locks).
 *
 * Esc — закрыть. Out-of-area click — НЕ закрывать (чтобы юзер мог
 * читать sidebar и одновременно скроллить content в editor'е).
 */
export function KbThreadsSidebar() {
  const open = useKbThreadsSidebarOpen();
  const ref = useRef<HTMLDivElement | null>(null);
  const ext = useExtension(CommentsExtension) as unknown as {
    threadStore: {
      getThreads: () => Map<string, {
        comments: { userId: string; deletedAt?: Date }[];
        resolvedBy?: string;
      }>;
      subscribe: (cb: () => void) => () => void;
    };
    userStore: {
      loadUsers: (ids: string[]) => Promise<void>;
    };
  };
  // Pre-warm guard: BN'овский ThreadsSidebar / Thread рендерит
  // RESOLVED-треды и в render-функции делает синхронный
  // `useUsers([resolvedBy]).get(resolvedBy) ?? throw` — если userStore
  // ещё не загрузил этого юзера, page крашится. resolveKbUsers
  // вызывается через async useEffect в BN UserStore, который не
  // успевает за первый render.
  //
  // Решение: pre-warm всех author + resolvedBy ID'шников ДО того
  // как ThreadsSidebar смонтируется. Открываем sidebar только
  // после того как userStore.loadUsers() завершится.
  const [usersReady, setUsersReady] = useState(false);

  // Reset sidebar-open state при unmount (= editor unmount = page
  // change). Без этого module-singleton isOpen «протекает» между
  // страницами: открыл sidebar на A → перешёл на B → у B уже открыт,
  // хотя юзер не toggle'ил. См. Codex #87 P2.
  useEffect(() => {
    return () => setKbThreadsSidebarOpen(false);
  }, []);

  // Pre-warm UserStore при открытии sidebar'а. Подписка на threadStore
  // обновляется когда realtime приносит новые треды/комменты — мы
  // догружаем новых участников.
  useEffect(() => {
    if (!open) {
      setUsersReady(false);
      return;
    }
    let cancelled = false;
    const collectAndLoad = async () => {
      const threads = ext.threadStore.getThreads();
      const ids = new Set<string>();
      for (const thread of threads.values()) {
        if (thread.resolvedBy) ids.add(thread.resolvedBy);
        for (const c of thread.comments) {
          if (!c.deletedAt) ids.add(c.userId);
        }
      }
      if (ids.size > 0) {
        await ext.userStore.loadUsers(Array.from(ids));
      }
      if (!cancelled) setUsersReady(true);
    };
    void collectAndLoad();
    // Re-warm на каждый thread-store update (realtime, optimistic).
    const unsub = ext.threadStore.subscribe(() => {
      void collectAndLoad();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [open, ext]);

  // Esc — закрыть. Listener живёт всегда — при closed просто no-op.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setKbThreadsSidebarOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (!open) return null;

  return (
    <aside
      ref={ref}
      className={cn(
        "fixed right-4 top-[72px] bottom-4 w-[360px] z-30",
        "rounded-xl border border-border bg-card shadow-lg",
        "flex flex-col overflow-hidden",
      )}
      role="complementary"
      aria-label="Все обсуждения на странице"
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-sm font-semibold text-foreground">
          Обсуждения
        </span>
        <button
          type="button"
          onClick={() => setKbThreadsSidebarOpen(false)}
          aria-label="Закрыть"
          className="inline-flex items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto bn-sheerly">
        {/* Render BN-овский ThreadsSidebar только после pre-warm'а
            UserStore (см. usersReady выше). Иначе BN'овский thread-
            renderer крашится на resolved-thread'ах синхронным throw'ом
            при пустом userCache. */}
        {usersReady ? (
          <ThreadsSidebar filter="all" sort="position" />
        ) : (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            Загрузка…
          </div>
        )}
      </div>
    </aside>
  );
}
