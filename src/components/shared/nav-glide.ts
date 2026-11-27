"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Подсветка активного пункта меню переезжает со старого пункта на новый,
 * а не прыгает (docs/motion.md, «Активный пункт меню»).
 *
 * Сами пункты держат свою подсветку (`aria-current="page"`): так она есть
 * с первого кадра, без ожидания скрипта. При смене страницы поверх старого
 * пункта появляется «призрак» той же формы и цвета и едет на место нового;
 * подсветка нового пункта на это время прячется (`data-nav-arriving`).
 * Если старый или новый пункт не виден (свёрнутый раздел, меню иконками),
 * подсветка просто меняется на месте.
 */
export function useActiveNavGlide(
  containerRef: RefObject<HTMLElement | null>,
  pathname: string,
  enabled: boolean,
) {
  const prevActive = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const next = container.querySelector<HTMLElement>('a[aria-current="page"]');
    const prev = prevActive.current;
    prevActive.current = next;
    if (!enabled || !prev || !next || prev === next) return;
    if (!prev.isConnected || !isShown(prev) || !isShown(next)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Свою смену цвета (transition-colors) у обоих пунктов на время
    // переезда гасим: иначе старая подсветка ещё 200 мс тает рядом с
    // призраком, а новая после его ухода проявляется второй раз.
    prev.style.transition = "none";
    next.style.transition = "none";
    const from = rectIn(container, prev);
    const to = rectIn(container, next);
    const radius = getComputedStyle(next).borderRadius;
    const ghost = document.createElement("span");
    ghost.setAttribute("aria-hidden", "true");
    ghost.dataset.navGlide = "";
    Object.assign(ghost.style, {
      position: "absolute",
      zIndex: "-1",
      pointerEvents: "none",
      left: "0px",
      top: "0px",
      borderRadius: radius,
      // Цвет подсветки активного пункта (workspace-appearance.module.css).
      background: "hsl(var(--brand) / 0.1)",
    });
    container.prepend(ghost);
    next.dataset.navArriving = "";
    requestAnimationFrame(() => prev.style.removeProperty("transition"));
    const animation = ghost.animate(
      [
        { transform: `translate(${from.x}px, ${from.y}px)`, width: `${from.w}px`, height: `${from.h}px` },
        { transform: `translate(${to.x}px, ${to.y}px)`, width: `${to.w}px`, height: `${to.h}px` },
      ],
      { duration: 420, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "forwards" },
    );
    const done = () => {
      ghost.remove();
      delete next.dataset.navArriving;
      requestAnimationFrame(() => next.style.removeProperty("transition"));
    };
    animation.onfinish = done;
    animation.oncancel = done;
    return () => animation.cancel();
  }, [containerRef, pathname, enabled]);
}

function isShown(el: HTMLElement) {
  return el.offsetHeight > 0 && !el.closest("[inert]");
}

function rectIn(container: HTMLElement, el: HTMLElement) {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return {
    x: r.left - c.left + container.scrollLeft,
    y: r.top - c.top + container.scrollTop,
    w: r.width,
    h: r.height,
  };
}
