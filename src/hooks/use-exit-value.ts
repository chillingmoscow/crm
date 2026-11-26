"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Сколько держать закрытую панель смонтированной: уход боковой панели —
 * 180 мс, окна — 160 мс (`.motion-sheet` / `.motion-dialog` в globals.css,
 * docs/motion.md), плюс запас на кадр.
 */
export const OVERLAY_EXIT_MS = 240;

/**
 * Значение, по которому открыта панель или окно, — и ещё `ms` после
 * закрытия.
 *
 * Если панель монтируется по условию (`{row && <Drawer open … />}`),
 * родитель убирает её в тот же кадр, когда её закрыли, и Radix не успевает
 * проиграть уход — панель исчезает рывком. С хуком панель держится, пока
 * уезжает:
 *
 * ```tsx
 * const shownRow = useExitValue(row);
 * {shownRow && <Drawer open={!!row} row={shownRow} … />}
 * ```
 *
 * Пока `value` не пустое, возвращает его же; когда опустело — прежнее
 * значение ещё `ms`, потом `null`. Охранные «Не сохранять изменения?»
 * работают как раньше: панель закрывается, только когда родитель обнулил
 * значение.
 */
export function useExitValue<T>(
  value: T | null | undefined | false,
  ms: number = OVERLAY_EXIT_MS,
): T | null {
  const live = value === null || value === undefined || value === false ? null : value;
  const last = useRef<T | null>(live);
  if (live !== null) last.current = live;
  const [, rerender] = useState(0);
  const closing = live === null && last.current !== null;

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => {
      last.current = null;
      rerender((n) => n + 1);
    }, ms);
    return () => clearTimeout(timer);
  }, [closing, ms]);

  return live ?? last.current;
}
