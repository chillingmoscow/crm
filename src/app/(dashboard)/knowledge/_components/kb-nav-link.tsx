"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  cancelPeekClose,
  schedulePeekClose,
  setKbSidebarPeek,
  toggleKbSidebarHidden,
  useKbSidebarVisibility,
} from "@/app/(dashboard)/knowledge/_components/kb-sidebar-visibility-store";

/**
 * Иконка «База знаний» в main-сайдбаре. Заменяет дефолтные
 * `FlatExpandedLink`/`FlatCollapsedLink` для секции с `href="/knowledge"`.
 *
 * Поведение:
 *   • Click когда юзер уже на /knowledge → toggle KB-сайдбара
 *     (visible ↔ hidden), пишется в cookie `kb_sidebar_hidden`.
 *     Никакой навигации, остаёмся на текущей странице.
 *   • Click когда не на /knowledge → обычная навигация
 *     (`<Link href="/knowledge">`).
 *   • Hover когда на /knowledge AND сайдбар скрыт → peek-overlay:
 *     KbSidebarShell рендерит сайдбар как fixed overlay. Mouseleave
 *     → 300мс grace-таймер; если за это время юзер увёл курсор на
 *     overlay-сайдбар (mouseenter на него отменяет таймер) — peek
 *     остаётся открытым.
 *
 * Цвет иконки:
 *   • На /knowledge AND visible → accent (foreground, активный пункт)
 *   • На /knowledge AND hidden → muted (тонкий намёк что сайдбар
 *     спрятан, но мы тут)
 *   • Не на /knowledge → стандартный sidebar-foreground
 */
export function KbNavLink({
  collapsed,
  initialHidden = false,
}: {
  collapsed: boolean;
  /** SSR-полученное значение из cookie `kb_sidebar_hidden` (читает
   *  dashboard/layout.tsx). Используется до hydration'а чтобы цвет
   *  иконки на первом рендере уже соответствовал реальному состоянию
   *  (Codex P2 на PR #129). */
  initialHidden?: boolean;
}) {
  const pathname = usePathname();
  const visibility = useKbSidebarVisibility();
  // SSR-mirror — пока не отрабатает hydration-effect в KbSidebarShell,
  // module-store ещё не получил cookie. Читаем `initialHidden` напрямую,
  // потом переключаемся на store. Без этого иконка на первом рендере
  // показывала бы default-state (visible/active) даже если cookie =
  // hidden — minor flicker'а цвета.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const hidden = hydrated ? visibility.hidden : initialHidden;
  const isOnKb = pathname === "/knowledge" || pathname.startsWith("/knowledge/");

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isOnKb) return; // обычная навигация — не трогаем
    e.preventDefault();
    toggleKbSidebarHidden();
  };

  const handleMouseEnter = () => {
    if (!isOnKb) return;
    if (!hidden) return; // когда виден — peek не нужен
    cancelPeekClose();
    setKbSidebarPeek(true);
  };

  const handleMouseLeave = () => {
    if (!isOnKb) return;
    if (!hidden) return;
    // Grace-таймер общий с KbSidebarShell: если юзер уведёт курсор
    // на overlay-сайдбар, его mouseenter отменит таймер.
    schedulePeekClose();
  };

  // Color logic:
  //   • on KB & visible → accent (active state)
  //   • on KB & hidden → muted (мы тут, но сайдбар спрятан)
  //   • not on KB → default
  const isActiveVisible = isOnKb && !hidden;
  const isActiveHidden = isOnKb && hidden;

  if (collapsed) {
    return (
      <Link
        href="/knowledge"
        aria-label="База знаний"
        title="База знаний"
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={cn(
          "flex items-center justify-center size-10 rounded-lg transition-colors hover:bg-sidebar-accent",
          isActiveVisible && "bg-sidebar-accent text-sidebar-accent-foreground",
          isActiveHidden && "text-muted-foreground",
          !isOnKb && "text-sidebar-foreground",
        )}
      >
        <BookOpen className="w-[18px] h-[18px]" />
      </Link>
    );
  }

  return (
    <Link
      href="/knowledge"
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-medium transition-colors hover:bg-sidebar-accent",
        isActiveVisible && "bg-sidebar-accent text-sidebar-accent-foreground",
        isActiveHidden && "text-muted-foreground",
        !isOnKb && "text-sidebar-foreground",
      )}
    >
      <BookOpen className="w-[18px] h-[18px] shrink-0" />
      <span className="flex-1 text-left">База знаний</span>
    </Link>
  );
}
