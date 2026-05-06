"use client";

import { useEffect, useMemo, type RefObject } from "react";

/**
 * Auto-height для title-textarea KB-страницы.
 *
 * Primary path — CSS `field-sizing: content` (Chrome 123+ / Safari 17.4+);
 * textarea сам растёт под содержимое, без JS-кода в hot path keystroke'а.
 * Fallback — JS height-set, но ВНУТРИ `requestAnimationFrame`, чтобы
 * избежать sync forced reflow на каждом keystroke (раньше было два
 * sync-write'а в `style.height` с layout-read'ом `scrollHeight` между
 * ними — заметно тормозило ввод длинных заголовков).
 *
 * Возвращает `cssFieldSizingSupported`, чтобы caller-onChange решил
 * нужен ли rAF-fallback на каждом keystroke.
 */
export function useKbTitleAutoHeight(
  ref: RefObject<HTMLTextAreaElement | null>,
  pageId: string,
): { cssFieldSizingSupported: boolean } {
  const cssFieldSizingSupported = useMemo(() => {
    if (typeof CSS === "undefined" || typeof CSS.supports !== "function")
      return false;
    return CSS.supports("field-sizing", "content");
  }, []);

  useEffect(() => {
    if (cssFieldSizingSupported) return;
    const ta = ref.current;
    if (!ta) return;
    const raf = requestAnimationFrame(() => {
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
    });
    return () => cancelAnimationFrame(raf);
  }, [pageId, cssFieldSizingSupported, ref]);

  return { cssFieldSizingSupported };
}
