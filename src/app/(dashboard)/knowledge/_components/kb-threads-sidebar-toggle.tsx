"use client";

import { MessageSquareText } from "lucide-react";

import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  toggleKbThreadsSidebar,
  useKbThreadsSidebarOpen,
} from "@/app/(dashboard)/knowledge/_components/kb-threads-sidebar-store";

/**
 * Toggle-кнопка «Все обсуждения» в page-header. Открывает/закрывает
 * KbThreadsSidebar — Notion / Google-Docs-style панель со списком
 * всех тредов на странице с фильтрами.
 *
 * Видна только когда commentsBundle активен (= юзер может смотреть
 * комментарии). Состояние хранится в module-store (kb-threads-sidebar-
 * store), потому что toggle и sidebar живут в разных React-tree'ях
 * (header-slot vs editor-renderExtras).
 */
export function KbThreadsSidebarToggle() {
  const open = useKbThreadsSidebarOpen();
  return (
    <IconTooltip
      label={open ? "Скрыть обсуждения" : "Все обсуждения"}
    >
      <button
        type="button"
        aria-label={open ? "Скрыть панель обсуждений" : "Показать все обсуждения"}
        aria-pressed={open}
        onClick={toggleKbThreadsSidebar}
        className={
          open
            ? "inline-flex items-center justify-center size-9 rounded-lg bg-accent text-foreground transition-colors"
            : "inline-flex items-center justify-center size-9 rounded-lg bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        }
      >
        <MessageSquareText className="w-[18px] h-[18px]" />
      </button>
    </IconTooltip>
  );
}
