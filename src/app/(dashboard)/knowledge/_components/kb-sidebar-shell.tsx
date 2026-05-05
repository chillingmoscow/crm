"use client";

import { useEffect, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";
import { KbSidebarResizer } from "@/app/(dashboard)/knowledge/_components/kb-sidebar-resizer";
import {
  cancelPeekClose,
  initKbSidebarHidden,
  schedulePeekClose,
  useKbSidebarVisibility,
} from "@/app/(dashboard)/knowledge/_components/kb-sidebar-visibility-store";

/**
 * Клиентская обёртка над KB-сайдбаром (resizer + tree).
 *
 * Три режима рендера:
 *   1. **visible** (`hidden=false`) — обычный inline-aside, sticky
 *      слева в гриде knowledge/layout. Это default.
 *   2. **hidden** (`hidden=true && !peeking`) — НИЧЕГО не рендерим
 *      (return null) — main-content в layout'е (`flex-1 min-w-0`)
 *      сам растянется на всю ширину.
 *   3. **peek** (`hidden=true && peeking=true`) — aside рендерится
 *      `position:fixed` overlay'ем над main-content'ом, со своим
 *      slide-in / box-shadow эффектом. На mouseleave запускаем
 *      300мс grace-таймер; если за это время mouseenter — таймер
 *      отменяется. Иначе → setKbSidebarPeek(false).
 *
 * Initial-state приходит с сервера (`initialHidden`, читается из cookie
 * в knowledge/layout.tsx) — записываем в store через
 * `initKbSidebarHidden()` на mount, чтобы избежать flicker'а при
 * гидратации.
 */
export function KbSidebarShell({
  initialHidden,
  sidebarInitialWidth,
  children,
}: {
  initialHidden: boolean;
  /** Прокидываем дальше в KbSidebarResizer (тоже cookie-backed,
   *  читается на сервере в том же knowledge/layout.tsx). */
  sidebarInitialWidth?: number;
  children: ReactNode;
}) {
  const { hidden, peeking } = useKbSidebarVisibility();
  // Берём текущее состояние main-сайдбара чтобы offset overlay'я был
  // корректным: collapsed = icon-width (~3rem), expanded = full-width.
  const { state: mainSidebarState, isMobile } = useSidebar();

  // Push initial state в store ОДИН раз. После этого sidebar.tsx (иконка)
  // и сам shell читают одинаковое значение через useKbSidebarVisibility.
  useEffect(() => {
    initKbSidebarHidden(initialHidden);
  }, [initialHidden]);

  // Cleanup grace-таймер на unmount, чтобы не задержался setTimeout
  // если юзер ушёл со страницы прямо во время peek'а. Таймер общий
  // с иконкой через store — здесь просто гасим, чтобы он не выстрелил
  // уже после демонтажа этого shell'а.
  useEffect(() => {
    return cancelPeekClose;
  }, []);

  // Inline visible — стандартный sticky aside. Стили совпадают с тем,
  // что было захардкодено в knowledge/layout.tsx (когда aside рендерился
  // прямо там).
  if (!hidden) {
    return (
      <aside
        aria-label="Дерево страниц"
        className="hidden md:flex sticky top-0 h-svh shrink-0
                   flex-col border-r bg-sidebar"
      >
        <KbSidebarResizer initialWidth={sidebarInitialWidth}>
          {children}
        </KbSidebarResizer>
      </aside>
    );
  }

  // Hidden && не peek → ничего. Main-content растягивается.
  if (!peeking) return null;

  // Peek-overlay: fixed, поверх main-content'а. left отступаем на
  // ширину main-сайдбара (collapsed = icon-width, expanded = full-width).
  // На мобильных main-сайдбар скрыт — left=0.
  const leftOffset = isMobile
    ? "0"
    : mainSidebarState === "collapsed"
      ? "var(--sidebar-width-icon)"
      : "var(--sidebar-width)";

  return (
    <aside
      aria-label="Дерево страниц (предпросмотр)"
      onMouseEnter={cancelPeekClose}
      onMouseLeave={schedulePeekClose}
      className={cn(
        "fixed top-0 z-40 h-svh shrink-0 flex flex-col",
        "border-r bg-sidebar shadow-xl",
        // Slide-in от main-сайдбара вправо. animate-in — tailwindcss-animate.
        "animate-in fade-in slide-in-from-left-2 duration-150",
      )}
      style={{ left: leftOffset }}
    >
      <KbSidebarResizer>{children}</KbSidebarResizer>
    </aside>
  );
}
