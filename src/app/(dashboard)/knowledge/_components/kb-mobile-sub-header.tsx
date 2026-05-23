"use client";

import { usePageHeaderBreadcrumb } from "@/components/shared/page-header-actions";
import { KbSaveStatusBadge } from "@/app/(dashboard)/knowledge/_components/kb-save-status";

/**
 * Мобильная вторая строка шапки БЗ: breadcrumb «‹ База знаний» + «Сохранено».
 * Рендерится ТОЛЬКО когда задан breadcrumb (т.е. на страницах-редакторах). На
 * экранах без breadcrumb (корень БЗ, дашборд с hideBreadcrumb) строки нет —
 * иначе была бы пустая sticky-полоса, съедающая высоту (Codex P2 на #438).
 */
export function KbMobileSubHeader() {
  const breadcrumb = usePageHeaderBreadcrumb();
  if (!breadcrumb) return null;
  return (
    <div className="md:hidden sticky top-14 z-20 flex items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
      {breadcrumb}
      <div className="flex-1" />
      <KbSaveStatusBadge />
    </div>
  );
}
