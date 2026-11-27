"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { NotificationBell } from "@/components/shared/notification-bell";
import { CommandPaletteTrigger } from "@/components/shared/command-palette-trigger";
import { PageHelpButton } from "@/app/(dashboard)/_components/page-help-button";
import {
  PageHeaderActionsSlot,
  PageHeaderBreadcrumbSlot,
} from "@/components/shared/page-header-actions";
import { isKnowledgePath } from "@/lib/knowledge/shell";
import { cn } from "@/lib/utils";

/**
 * Dashboard topbar — стандартная верхняя плашка приложения.
 *
 * База знаний рендерит ту же плашку сама, в своей правой колонке
 * (`inKnowledge`), чтобы дерево страниц шло во всю высоту экрана; в общем
 * layout на её маршрутах плашка не рисуется. Слоты пути и действий одни —
 * в каждый момент смонтирована одна плашка.
 *
 * `leading` — после кнопки меню на телефоне (в базе — «Страницы»),
 * `afterBreadcrumb` — сразу после пути (в базе — «Сохранено»).
 */
export function DashboardTopbar({
  inKnowledge = false,
  leading,
  afterBreadcrumb,
}: {
  inKnowledge?: boolean;
  leading?: ReactNode;
  afterBreadcrumb?: ReactNode;
}) {
  const pathname = usePathname();
  if (!inKnowledge && isKnowledgePath(pathname)) return null;
  return (
    <header
      data-dashboard-topbar
      className={cn(
        "flex h-14 items-center gap-2 px-6",
        // В документе действия страницы (⋯, «Сохранено») нужны и в конце
        // длинного текста — в базе плашка прилипает к верху.
        inKnowledge && "sticky top-0 z-30",
      )}
    >
      <SidebarTrigger className="md:hidden" />
      {leading}
      <PageHeaderBreadcrumbSlot />
      {afterBreadcrumb}
      <div className="flex-1" />
      <CommandPaletteTrigger />
      <PageHeaderActionsSlot />
      <PageHelpButton />
      <NotificationBell />
    </header>
  );
}
