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
        "flex h-14 items-center gap-2",
        // В базе на телефоне в строке шесть значков, «Страницы» и иногда чип
        // блокировки: поля меньше, а значки 36px стоят вплотную (у значка
        // 18px и так 18px воздуха), иначе колокольчик уходит за край.
        inKnowledge ? "px-4 md:px-6" : "px-6",
        // В документе действия страницы (⋯, «Сохранено») нужны и в конце
        // длинного текста — в базе плашка прилипает к верху.
        // Под баннером режима просмотра (он fixed сверху) — с его отступом.
        inKnowledge && "sticky top-[var(--impersonation-offset,0px)] z-30",
      )}
    >
      <SidebarTrigger className="shrink-0 md:hidden" />
      {leading}
      {inKnowledge ? (
        // На телефоне рядом с «Страницы» путь не помещается и наезжает на
        // значки справа; заголовок страницы и так виден под шапкой.
        <div className="hidden min-w-0 items-center md:flex">
          <PageHeaderBreadcrumbSlot />
        </div>
      ) : (
        <PageHeaderBreadcrumbSlot />
      )}
      {afterBreadcrumb}
      {/* Кнопки справа не сжимаются: при нехватке места обрезается путь,
       * а не значки 36px. Прижаты вправо через ml-auto, а не пустым
       * блоком: тот съедал лишний зазор, которого на телефоне нет. */}
      <div className={cn("ml-auto flex shrink-0 items-center gap-2", inKnowledge && "max-md:gap-0")}>
        <CommandPaletteTrigger />
        <PageHeaderActionsSlot />
        <PageHelpButton />
        <NotificationBell />
      </div>
    </header>
  );
}
