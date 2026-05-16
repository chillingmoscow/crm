"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * GlobalTooltip — единый источник подсказок для всего приложения.
 *
 * Зачем существует: CSS-`::after`-тултипы (старый подход через
 * `[data-tip]:hover::after`) обрезались ЛЮБЫМ родителем с `overflow`
 * (сайдбар, скролл-контейнеры, dropdown'ы) и прятались за соседними
 * элементами. Портальный рендер в `document.body` с `position: fixed`
 * не обрезается ничем и не зависит от stacking-контекста.
 *
 * Контракт разметки:
 *  - `data-tip="Текст"` на любом интерактивном элементе → подсказка.
 *  - `data-tip-sub="Доп. строка"` (опц.) → серая вторая строка
 *    (шорткат / пояснение), как у IconTooltip.
 *  - Кнопки BlockNote side-menu (drag-handle / «+») разметку которых
 *    мы не контролируем — подхватываются по `aria-label`.
 *
 * Один стиль, одна задержка — синхронно со shadcn Tooltip
 * (components/ui/tooltip.tsx) и TooltipProvider (~500мс).
 */

const DELAY_MS = 500;
const SIDE_MENU_SELECTOR = ".bn-side-menu .bn-button[aria-label]";

type Resolved = { el: HTMLElement; label: string; sub: string | null };

function resolve(node: EventTarget | null): Resolved | null {
  if (!(node instanceof Element)) return null;

  const dataEl = node.closest<HTMLElement>("[data-tip]");
  if (dataEl) {
    const label = dataEl.getAttribute("data-tip");
    if (label && label.trim()) {
      return { el: dataEl, label, sub: dataEl.getAttribute("data-tip-sub") };
    }
  }

  const sideEl = node.closest<HTMLElement>(SIDE_MENU_SELECTOR);
  if (sideEl) {
    const label = sideEl.getAttribute("aria-label");
    if (label && label.trim()) return { el: sideEl, label, sub: null };
  }

  return null;
}

type TipState = { label: string; sub: string | null; rect: DOMRect };

export function GlobalTooltip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const tipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    const hide = () => {
      clearTimer();
      elRef.current = null;
      setTip(null);
      setCoords(null);
    };

    const onOver = (event: Event) => {
      const found = resolve(event.target);
      if (!found) return;
      if (elRef.current === found.el) return;
      clearTimer();
      elRef.current = found.el;
      timerRef.current = setTimeout(() => {
        if (!found.el.isConnected) return;
        setCoords(null);
        setTip({
          label: found.label,
          sub: found.sub,
          rect: found.el.getBoundingClientRect(),
        });
      }, DELAY_MS);
    };

    const onOut = (event: Event) => {
      const el = elRef.current;
      if (!el) return;
      const related = (event as PointerEvent).relatedTarget;
      if (related instanceof Node && el.contains(related)) return;
      hide();
    };

    const onKeyDown = (event: Event) => {
      if ((event as KeyboardEvent).key === "Escape") hide();
    };

    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("focusin", onOver, true);
    document.addEventListener("focusout", hide, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", hide);

    return () => {
      clearTimer();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("focusin", onOver, true);
      document.removeEventListener("focusout", hide, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tip || !tipRef.current) return;
    const box = tipRef.current.getBoundingClientRect();
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = tip.rect.bottom + gap;
    if (top + box.height > vh - 4) {
      const above = tip.rect.top - box.height - gap;
      top = above >= 4 ? above : Math.max(4, vh - box.height - 4);
    }
    let left = tip.rect.left + tip.rect.width / 2 - box.width / 2;
    left = Math.max(4, Math.min(left, vw - box.width - 4));

    setCoords({ top, left });
  }, [tip]);

  if (!tip) return null;

  return createPortal(
    <div
      ref={tipRef}
      role="tooltip"
      style={{
        position: "fixed",
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        zIndex: 2147483647,
        visibility: coords ? "visible" : "hidden",
        pointerEvents: "none",
        maxWidth: 280,
      }}
      className="rounded-md bg-neutral-900 px-3 py-1.5 shadow-lg animate-in fade-in-0 zoom-in-95"
    >
      <span className="block text-xs font-semibold leading-tight text-neutral-50">
        {tip.label}
      </span>
      {tip.sub && (
        <span className="mt-0.5 block text-xs font-normal leading-tight text-neutral-200">
          {tip.sub}
        </span>
      )}
    </div>,
    document.body,
  );
}
