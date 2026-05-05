"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const COOKIE_KEY = "kb_sidebar_width";
const LEGACY_STORAGE_KEY = "kb-sidebar-width";
const DEFAULT_WIDTH = 288; // соответствует w-72 (текущий default)
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 год

/**
 * Wrapper для KB-сайдбара с возможностью drag-resize правой границы.
 *
 * Ширина сохраняется в cookie `kb_sidebar_width` (per-user, без
 * серверного state'а — это чисто UI-предпочтение). Сервер читает
 * cookie в knowledge/layout.tsx и пробрасывает `initialWidth` сюда:
 * первый рендер уже идёт на сохранённой ширине → 0 layout-shift'а
 * после hydration'а. (Раньше использовался localStorage, но он
 * недоступен на сервере — отсюда «прыжок» 288 → savedWidth при
 * reload'е.)
 *
 * Drag-handle — невидимая 4px полоска у правого края, hover делает её
 * слегка видимой (brand-тёплый акцент). Pointer-капчура на mousedown,
 * `body { cursor: ew-resize }` на время drag'а чтобы курсор не
 * прыгал когда мышь уходит за пределы handle'а.
 */
export function KbSidebarResizer({
  children,
  initialWidth,
}: {
  children: ReactNode;
  /** SSR-полученная ширина из cookie (через knowledge/layout.tsx).
   *  Нужна для рендера до гидратации без CLS — fallback'ом DEFAULT_WIDTH. */
  initialWidth?: number;
}) {
  const startWidth = clamp(initialWidth ?? DEFAULT_WIDTH);
  const [width, setWidth] = useState<number>(startWidth);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(startWidth);

  // One-time миграция legacy-localStorage → cookie. На последующих
  // mount'ах no-op (раз стёрли — больше нет).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return;
      const parsed = parseInt(raw, 10);
      if (!Number.isNaN(parsed) && !readCookie(COOKIE_KEY)) {
        const w = clamp(parsed);
        writeCookie(COOKIE_KEY, String(w));
        setWidth(w);
      }
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // localStorage недоступен (private mode) — пропускаем.
    }
  }, []);

  /** Body-styles, выставляемые на время drag'а. Гарантированный
   *  cleanup — отдельная ф-ция, чтобы вызывать из всех путей выхода
   *  из drag-state'а: pointerUp, pointerCancel, lostPointerCapture,
   *  unmount-effect (Codex P2 на PR #121: при interrupted drag /
   *  navigation body раньше залипал в `cursor: ew-resize` до reload'а). */
  const stopDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    // Cursor + user-select: ставим на body на время drag'а, чтобы:
    //   1. при mouse-move за пределы handle'а курсор не возвращался к
    //      default-стрелке;
    //   2. текст в редакторе случайно не выделялся drag'ом.
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const delta = e.clientX - startXRef.current;
    setWidth(clamp(startWidthRef.current + delta));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    stopDrag();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // pointer уже отпущен в каких-то корнер-кейсах
    }
    // Persist финальную ширину после release'а — пишем в cookie
    // ОДИН раз, не на каждое pointermove. Cookie не httpOnly: пишется
    // прямо из клиента, читается на сервере в knowledge/layout.tsx.
    writeCookie(COOKIE_KEY, String(width));
  };

  // lostPointerCapture: capture может прерваться извне (другой элемент
  // забрал capture, browser-tab swap, OS-event). Если drag активен —
  // снимаем body-styles, иначе застрянет «ew-resize» (Codex P2).
  const onLostPointerCapture = () => {
    stopDrag();
  };

  // Cleanup на unmount: если компонент unmount'ится во время drag'а
  // (route-навигация и т.п.), pointerUp может не вызваться вообще.
  // Гарантированно сбрасываем глобальные body-styles.
  useEffect(
    () => () => {
      stopDrag();
    },
    [],
  );

  return (
    <div
      // Replace'ом w-72 (288px) на explicit-width управляемую state'ом.
      // Сохраняем все остальные классы из <aside> наружу — обёртка
      // лежит ВНУТРИ <aside>, без re-position'а layout'а.
      className="relative h-full"
      style={{ width }}
    >
      {children}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Изменить ширину сайдбара"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onLostPointerCapture}
        className={cn(
          "absolute top-0 right-0 h-full w-1 cursor-ew-resize",
          // Hover-индикатор + active-состояние через ::before
          // (hairline 1px вертикальная линия, brand-цветом).
          "before:absolute before:inset-y-0 before:right-0 before:w-px",
          "before:bg-transparent hover:before:bg-brand/40",
          "transition-colors",
        )}
      />
    </div>
  );
}

function clamp(n: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, n));
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(
      "(?:^|; )" + name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&") + "=([^;]*)",
    ),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  document.cookie =
    `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}
