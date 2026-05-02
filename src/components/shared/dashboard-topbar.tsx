"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { NotificationBell } from "@/components/shared/notification-bell";
import {
  PageHeaderActionsSlot,
  PageHeaderBreadcrumbSlot,
} from "@/components/shared/page-header-actions";

/**
 * Dashboard topbar — стандартная верхняя плашка приложения.
 *
 * Скрывается на маршрутах /knowledge*: KB рендерит собственный
 * top-bar внутри своего layout'а (см. knowledge/layout.tsx), чтобы
 * боковое дерево могло занимать всю высоту экрана. Слоты breadcrumb
 * и actions при этом потребляются KB-локальным топбаром через тот же
 * PageHeaderContext (один consumer mounted в один момент времени).
 */
export function DashboardTopbar() {
  const pathname = usePathname();
  if (pathname?.startsWith("/knowledge")) return null;
  return (
    <header className="flex h-14 items-center gap-2 px-6">
      <SidebarTrigger className="md:hidden" />
      <PageHeaderBreadcrumbSlot />
      <div className="flex-1" />
      <PageHeaderActionsSlot />
      <NotificationBell />
    </header>
  );
}
