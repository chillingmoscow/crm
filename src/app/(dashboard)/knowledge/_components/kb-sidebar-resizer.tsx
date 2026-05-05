"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "kb-sidebar-width";
const DEFAULT_WIDTH = 288; // соответствует w-72 (текущий default)
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

/**
 * Wrapper для KB-сайдбара с возможностью drag-resize правой границы.
 *
 * Ширина сохраняется в localStorage (per-user, без серверного state'а
 * — это чисто UI-предпочтение). На SSR'е всегда рендерится с
 * default-значением 288px; после mount'а гидрируется реальной
 * шириной без CLS — `style.width` ставим только когда оно отличается
 * от дефолта.
 *
 * Drag-handle — невидимая 4px полоска у правого края, hover делает её
 * слегка видимой (brand-тёплый акцент). Pointer-капчура на mousedown,
 * `body { cursor: ew-resize }` на время drag'а чтобы курсор не
 * прыгал когда мышь уходит за пределы handle'а.
 */
export function KbSidebarResizer({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [hydrated, setHydrated] = useState(false);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(DEFAULT_WIDTH);

  // Hydrate from localStorage один раз на mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = parseInt(raw, 10);
        if (!Number.isNaN(parsed)) {
          setWidth(clamp(parsed));
        }
      }
    } catch {
      // localStorage недоступен (private mode и т.п.) — остаёмся с
      // default-шириной.
    }
    setHydrated(true);
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
    // Persist финальную ширину после release'а — пишем в localStorage
    // ОДИН раз, не на каждое pointermove.
    try {
      window.localStorage.setItem(STORAGE_KEY, String(width));
    } catch {
      // ignore
    }
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

  // Default-width всегда inline-style'ом, чтобы avoid CLS. После
  // hydration'а switch'аемся на пользовательскую ширину из
  // localStorage (если отличается — minor layout shift в момент
  // hydration'а; для большинства юзеров с default-шириной flash'а нет).
  const style = { width: hydrated ? width : DEFAULT_WIDTH };

  return (
    <div
      // Replace'ом w-72 (288px) на explicit-width управляемую state'ом.
      // Сохраняем все остальные классы из <aside> наружу — обёртка
      // лежит ВНУТРИ <aside>, без re-position'а layout'а.
      className="relative h-full"
      style={style}
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
