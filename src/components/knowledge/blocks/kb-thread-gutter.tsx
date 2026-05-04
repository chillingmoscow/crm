"use client";

import { useLayoutEffect, useState } from "react";
import { MessageSquare } from "lucide-react";

import {
  useBlockNoteEditor,
  useExtension,
  useThreads,
} from "@blocknote/react";
import { CommentsExtension } from "@blocknote/core/comments";

import { cn } from "@/lib/utils";

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
  const [items, setItems] = useState<IndicatorPos[]>([]);

  // Recompute caller — собирает positions через querySelectorAll'ы.
  // useLayoutEffect/effect: вызываем при изменениях threads, а ниже
  // подключаем MutationObserver + scroll/resize для DOM-зависимых
  // апдейтов.
  useLayoutEffect(() => {
    // Координаты — viewport-based (для `position: fixed`). Переcчёт
     // на scroll/resize держит индикаторы синхронно с прокруткой.
     // Альтернатива (position:absolute от .bn-editor) сложнее, потому
     // что у BN-обёрток нет надёжного positioned-предка в нашей DOM-
     // иерархии — пришлось бы добавлять wrapper.
    function recompute() {
      const editorEl = (editor as unknown as { domElement?: HTMLElement })
        .domElement;
      if (!editorEl) return;
      const blockMap = new Map<
        HTMLElement,
        { count: number; firstThreadId: string }
      >();
      threads.forEach((thread, id) => {
        if (thread.resolved || thread.deletedAt) return;
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
      setItems(next);
    }

    recompute();

    const editorEl = (editor as unknown as { domElement?: HTMLElement })
      .domElement;
    if (!editorEl) return;

    const observer = new MutationObserver(recompute);
    observer.observe(editorEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-bn-thread-id", "data-orphan"],
    });

    // Scroll/resize меняют позицию блоков — пересчитываем.
    const onLayout = () => recompute();
    window.addEventListener("scroll", onLayout, true);
    window.addEventListener("resize", onLayout);
    // Editor change — выправляет, когда content layout пересчитан
    // (insert/delete/typing).
    const offChange = (
      editor as unknown as {
        onChange: (fn: () => void) => () => void;
      }
    ).onChange(onLayout);

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onLayout, true);
      window.removeEventListener("resize", onLayout);
      offChange();
    };
  }, [editor, threads]);

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
          title={
            it.count === 1
              ? "Открыть обсуждение"
              : `${it.count} обсуждений в этом блоке`
          }
          onClick={() => ext.selectThread(it.firstThreadId)}
          style={{
            position: "fixed",
            top: `${it.top}px`,
            left: `${it.left}px`,
            transform: "translateY(-50%)",
          }}
          className={cn(
            "inline-flex items-center gap-1 px-1.5 h-6 rounded-md",
            "bg-amber-50 hover:bg-amber-100",
            "dark:bg-amber-900/30 dark:hover:bg-amber-900/50",
            "text-amber-700 dark:text-amber-400",
            "transition-colors cursor-pointer z-10",
            "shadow-sm border border-amber-200/60 dark:border-amber-700/40",
          )}
        >
          <MessageSquare className="size-3.5" strokeWidth={2.25} />
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
