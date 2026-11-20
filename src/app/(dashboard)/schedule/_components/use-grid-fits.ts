"use client";

import { useCallback, useState } from "react";

/** Минимальная ширина недельной сетки: 7 дней по ~95px и колонка имён. */
export const GRID_MIN_WIDTH = 900;

/**
 * Помещается ли недельная сетка в ширину контейнера.
 *
 * Как у списочных таблиц (`data-table.module.css`): пока сетка помещается,
 * у обёртки нет overflow — страница прокручивается целиком, шапка дней
 * закреплена к окну. Не помещается (узкое окно, планшет) — обёртка получает
 * собственную прокрутку с `max-height`, чтобы при прокрутке вбок колонка
 * имён и шапка оставались на месте. До первого замера считаем, что
 * помещается: так сетка не мигает рамкой прокрутки на обычном экране.
 */
export function useGridFits(minWidth: number = GRID_MIN_WIDTH) {
  const [fits, setFits] = useState(true);
  const ref = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return;
      const measure = () => setFits(node.clientWidth >= minWidth);
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => observer.disconnect();
    },
    [minWidth],
  );
  return { ref, fits };
}

/**
 * Классы обёртки сетки: без overflow, пока помещается; иначе своя прокрутка.
 * Без overflow обёртка не обрезает углы — скругляем крайние ячейки шапки.
 */
export function gridScrollClass(fits: boolean) {
  return fits
    ? "[&_thead_th:first-child]:rounded-tl-[calc(var(--radius)-1px)] [&_thead_th:last-child]:rounded-tr-[calc(var(--radius)-1px)]"
    : "max-h-[72dvh] overflow-auto";
}
