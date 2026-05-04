"use client";

import { useEffect, useRef } from "react";
import { ThreadsSidebar } from "@blocknote/react";
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
        {/* BN-овский ThreadsSidebar — сортировка по позиции в документе
            (matches Notion: первый коммент — тот, что выше в тексте),
            показываем все треды (open + resolved), filter-tabs внутри
            BN-компонента сам рендерит. */}
        <ThreadsSidebar filter="all" sort="position" />
      </div>
    </aside>
  );
}
