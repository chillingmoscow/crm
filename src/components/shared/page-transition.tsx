"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Мягкая смена страницы (docs/motion.md, «Переход между страницами»).
 *
 * Шапка и меню живут вне этого контейнера и не перерисовываются; новый
 * контент проявляется с подъёмом 6px. Анимация идёт через Web Animations
 * API на уже смонтированном элементе — ничего не пересоздаётся, состояние
 * вложенных layout'ов (дерево базы знаний, вкладки акта) сохраняется.
 *
 * Не анимируем:
 *  — смену только параметров адреса (фильтры, открытая карточка): pathname
 *    тот же;
 *  — переходы внутри одного «экрана с вкладками-маршрутами» (акт
 *    инвентаризации) и внутри базы знаний: у них своя шапка внутри
 *    контейнера, и она моргала бы;
 *  — при `prefers-reduced-motion: reduce`.
 */
export function PageTransition({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const pathname = usePathname() ?? "";
  const ref = useRef<HTMLElement>(null);
  const prevScope = useRef<string | null>(null);

  useLayoutEffect(() => {
    const scope = transitionScope(pathname);
    const prev = prevScope.current;
    prevScope.current = scope;
    if (prev === null || prev === scope) return;
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Идёт собственный view transition (перелёт аватара в карточку) —
    // он сам ведёт смену, второе движение поверх не нужно.
    if ((document as Document & { activeViewTransition?: unknown }).activeViewTransition)
      return;
    el.animate(
      [
        { opacity: 0, translate: "0 6px" },
        { opacity: 1, translate: "0 0" },
      ],
      { duration: 360, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
    );
  }, [pathname]);

  return (
    <main ref={ref} className={cn(className)}>
      {children}
    </main>
  );
}

/** Ключ «экрана»: переход анимируется, только когда он меняется. */
export function transitionScope(pathname: string): string {
  if (pathname === "/knowledge" || pathname.startsWith("/knowledge/"))
    return "/knowledge";
  const act = pathname.match(/^\/documents\/inventory\/[^/]+/);
  if (act && act[0] !== "/documents/inventory/archive") return act[0];
  return pathname;
}
