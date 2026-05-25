"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import { MessageSquare } from "lucide-react";

import {
  useBlockNoteEditor,
  useExtension,
  useThreads,
} from "@blocknote/react";
import { CommentsExtension } from "@blocknote/core/comments";

import { cn } from "@/lib/utils";
import { useCoarsePointer } from "@/hooks/use-mobile";

/**
 * Gutter-индикатор для блоков с комментариями: пиктограмма-облачко
 * + счётчик количества тредов в блоке. Клик — открывает первый тред
 * (BN'овский `selectThread(id)` поднимает FloatingThreadController).
 *
 * Реализация:
 *   1. Подписываемся на `useThreads()` — карта thread_id → ThreadData.
 *   2. На каждый change DOM (MutationObserver на .bn-editor) или
 *      смену threads-store пересчитываем mapping block→threads через
 *      DOM-запросы (`[data-bn-thread-id]:not([data-orphan="true"])`
 *      → ближайший `.bn-block-content`).
 *   3. Рендерим абсолютно-позиционированные кнопки относительно
 *      `<.bn-editor>` (родителя нашего портала).
 *
 * Resolved- и orphan-треды не показываем — индикатор только для
 * актуальных, на которые юзер должен обратить внимание.
 */

interface IndicatorPos {
  key: string;
  top: number;
  left: number;
  count: number;
  firstThreadId: string;
}

export function KbThreadGutterIndicators() {
  const editor = useBlockNoteEditor();
  const ext = useExtension(CommentsExtension) as unknown as {
    selectThread: (id: string) => void;
  };
  const threads = useThreads();
  const isTouch = useCoarsePointer();
  const [items, setItems] = useState<IndicatorPos[]>([]);
  const hasActiveThreads = useMemo(
    () =>
      [...threads].some(([, thread]) => !thread.resolved && !thread.deletedAt),
    [threads],
  );

  // Recompute caller — собирает positions через querySelectorAll'ы.
  // useLayoutEffect/effect: вызываем при изменениях threads, а ниже
  // подключаем MutationObserver + scroll/resize для DOM-зависимых
  // апдейтов.
  useLayoutEffect(() => {
    if (!hasActiveThreads) {
      setItems([]);
      return;
    }
    // Координаты — viewport-based (для `position: fixed`). Переcчёт
     // на scroll/resize держит индикаторы синхронно с прокруткой.
     // Альтернатива (position:absolute от .bn-editor) сложнее, потому
     // что у BN-обёрток нет надёжного positioned-предка в нашей DOM-
     // иерархии — пришлось бы добавлять wrapper.
    let rafId: number | null = null;
    let lastSignature = "";

    const publishItems = (next: IndicatorPos[]) => {
      const signature = next
        .map((it) => `${it.key}:${Math.round(it.top)}:${Math.round(it.left)}:${it.count}`)
        .join("|");
      if (signature === lastSignature) return;
      lastSignature = signature;
      setItems(next);
    };

    function recompute() {
      rafId = null;
      const editorEl = (editor as unknown as { domElement?: HTMLElement })
        .domElement;
      if (!editorEl) return;
      const activeThreads = [...threads].filter(([, thread]) => (
        !thread.resolved && !thread.deletedAt
      ));
      if (activeThreads.length === 0) {
        publishItems([]);
        return;
      }
      const blockMap = new Map<
        HTMLElement,
        { count: number; firstThreadId: string }
      >();
      activeThreads.forEach(([id]) => {
        const mark = editorEl.querySelector(
          `[data-bn-thread-id="${cssEscape(id)}"]:not([data-orphan="true"])`,
        );
        if (!mark) return;
        const block = mark.closest(".bn-block-content") as HTMLElement | null;
        if (!block) return;
        const cur = blockMap.get(block);
        if (cur) cur.count++;
        else blockMap.set(block, { count: 1, firstThreadId: id });
      });

      const next: IndicatorPos[] = [];
      blockMap.forEach((info, block) => {
        const r = block.getBoundingClientRect();
        next.push({
          key: info.firstThreadId,
          top: r.top + r.height / 2,
          left: r.right + 8,
          count: info.count,
          firstThreadId: info.firstThreadId,
        });
      });
      publishItems(next);
    }

    function scheduleRecompute() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(recompute);
    }

    scheduleRecompute();

    const editorEl = (editor as unknown as { domElement?: HTMLElement })
      .domElement;
    if (!editorEl) return;

    const observer = new MutationObserver(scheduleRecompute);
    observer.observe(editorEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-bn-thread-id", "data-orphan"],
    });

    // Scroll/resize меняют позицию блоков — пересчитываем.
    const onLayout = () => scheduleRecompute();
    const scrollOptions: AddEventListenerOptions = {
      capture: true,
      passive: true,
    };
    window.addEventListener("scroll", onLayout, scrollOptions);
    window.addEventListener("resize", onLayout);
    // Editor change — выправляет, когда content layout пересчитан
    // (insert/delete/typing). Через rAF, чтобы DOM успел отдать
    // новые bounding rect'ы (BN apply'ит updateBlock'и в синхронной
    // части `onChange`, до browser paint'а — getBoundingClientRect
    // ещё видит старую разметку).
    const offChange = (
      editor as unknown as {
        onChange: (fn: () => void) => () => void;
      }
    ).onChange(() => {
      scheduleRecompute();
    });

    // ResizeObserver — главное для image/video-resize'а. Resize-handle
    // BN'а пушит inline-style.width на `.bn-visual-media-wrapper` через
    // pointer-move без editor-transaction'а, поэтому ни MutationObserver
    // (attributeFilter на thread-id), ни onChange нас не разбудят. RO
    // на сам editor-root ловит ВСЕ изменения layout-размеров его
    // descendants → пересчёт позиций индикаторов синхронно с resize'ом.
    const ro = new ResizeObserver(() => {
      scheduleRecompute();
    });
    ro.observe(editorEl);
    // Дополнительно — все resizable-wrapper'ы (image / video / file).
    // .bn-visual-media-wrapper меняет свою width inline-style'ом, root
    // editor-element при этом не меняет общий размер, и outer RO
    // не получает entry. Подписка на каждый wrapper отдельно гарантирует
    // событие. Список wrapper'ов перепроверяется на MutationObserver-
    // тике (новые блоки).
    const observedMedia = new WeakSet<HTMLElement>();
    function ensureMediaResizeObserved() {
      const wrappers = editorEl!.querySelectorAll<HTMLElement>(
        ".bn-visual-media-wrapper",
      );
      wrappers.forEach((el) => {
        if (observedMedia.has(el)) return;
        observedMedia.add(el);
        ro.observe(el);
      });
    }
    ensureMediaResizeObserved();
    const mediaWatcher = new MutationObserver(ensureMediaResizeObserved);
    mediaWatcher.observe(editorEl, { childList: true, subtree: true });

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
      mediaWatcher.disconnect();
      ro.disconnect();
      window.removeEventListener("scroll", onLayout, scrollOptions);
      window.removeEventListener("resize", onLayout);
      offChange();
    };
  }, [editor, threads, hasActiveThreads]);

  if (items.length === 0) return null;

  return (
    <>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          aria-label={
            it.count === 1
              ? "Открыть обсуждение"
              : `Открыть обсуждения (${it.count})`
          }
          data-tip={
            it.count === 1
              ? "Открыть обсуждение"
              : `${it.count} обсуждений в этом блоке`
          }
          onClick={() => ext.selectThread(it.firstThreadId)}
          style={
            isTouch
              ? {
                  // На мобильном блок занимает почти всю ширину, поэтому
                  // `left: block.right + 8` уезжает за правый край экрана и
                  // индикатор не виден. Прижимаем к правому краю viewport'а.
                  position: "fixed",
                  top: `${it.top}px`,
                  right: 6,
                  transform: "translateY(-50%)",
                }
              : {
                  position: "fixed",
                  top: `${it.top}px`,
                  left: `${it.left}px`,
                  transform: "translateY(-50%)",
                }
          }
          className={cn(
            "inline-flex items-center gap-1 rounded-md",
            // На touch компактнее, чтобы не съедать место над текстом.
            isTouch ? "px-1 h-5" : "px-1.5 h-6",
            "bg-amber-50 hover:bg-amber-100",
            "dark:bg-amber-900/30 dark:hover:bg-amber-900/50",
            "text-amber-700 dark:text-amber-400",
            "transition-colors cursor-pointer z-10",
            "shadow-sm border border-amber-200/60 dark:border-amber-700/40",
          )}
        >
          <MessageSquare
            className={isTouch ? "size-3" : "size-3.5"}
            strokeWidth={2.25}
          />
          {it.count > 1 && (
            <span className="text-[11px] font-semibold leading-none tabular-nums">
              {it.count}
            </span>
          )}
        </button>
      ))}
    </>
  );
}

/** CSS.escape polyfill-ish для thread_id. UUID-формат не имеет
 *  спец-символов, но привычка перестраховываться. */
function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/["\\]/g, "\\$&");
}
