"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import type { Theme as EmojiTheme, EmojiClickData } from "emoji-picker-react";
import { Theme as EmojiThemeEnum } from "emoji-picker-react";
import { useTheme } from "next-themes";

import type { BlockNoteEditor } from "@blocknote/core";

// emoji-picker-react ~16KB gzip + sprite-данные. SSR-skip + lazy чтобы
// не утащить это в initial bundle страниц без редактора.
const EmojiPicker = dynamic(() => import("emoji-picker-react"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-[360px] h-[420px] text-sm text-muted-foreground">
      Загрузка эмодзи…
    </div>
  ),
});

/* ─── Module store ───────────────────────────────────────────────────────
   Slash-item «Эмодзи» (см. blocknote-editor.tsx → getKbEmojiSlashItem)
   зовёт `openKbEmojiPicker(editor, anchor)` — overlay рендерится
   `<KbEmojiPickerOverlay>` поверх viewport'а, инсертит эмодзи в editor
   через `editor.insertInlineContent` и сам себя закрывает.

   Хранится в module-store по той же причине, что и kb-editor-store.ts —
   slash-item исполняется в momentary callback'е, а overlay живёт как
   персистентный компонент в дереве редактора. */

interface PickerState {
  open: boolean;
  editor: BlockNoteEditor | null;
  anchor: { x: number; y: number } | null;
}

const listeners = new Set<() => void>();
let state: PickerState = { open: false, editor: null, anchor: null };

function notify() {
  for (const l of listeners) l();
}

export function openKbEmojiPicker(
  editor: BlockNoteEditor,
  anchor: { x: number; y: number },
) {
  state = { open: true, editor, anchor };
  notify();
}

export function closeKbEmojiPicker() {
  if (!state.open) return;
  state = { open: false, editor: null, anchor: null };
  notify();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function useKbEmojiPickerState(): PickerState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => ({ open: false, editor: null, anchor: null }),
  );
}

/* ─── Overlay component ─────────────────────────────────────────────── */

const PICKER_WIDTH = 360;
const PICKER_HEIGHT = 420;

/**
 * Глобальный overlay для emoji-picker'а. Рендерится один раз внутри
 * KbBlockNoteEditor через `renderExtras` слот; видимость управляется
 * module-store'ом (`openKbEmojiPicker / closeKbEmojiPicker`).
 *
 * Закрывается на: клик вне, Escape, выбор эмодзи. Position-clamp
 * к viewport'у — picker не уезжает за край при наборе у нижнего
 * бордера страницы.
 */
export function KbEmojiPickerOverlay() {
  const { open, editor, anchor } = useKbEmojiPickerState();
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Клавиатура + клик-вне.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeKbEmojiPicker();
      }
    };
    const onClick = (e: MouseEvent) => {
      const node = containerRef.current;
      if (!node) return;
      if (e.target instanceof Node && !node.contains(e.target)) {
        closeKbEmojiPicker();
      }
    };
    document.addEventListener("keydown", onKey);
    // Клик регистрируем в capture-фазе чтобы не словить React-обработчик
    // на самом overlay'е раньше browser-event'а.
    document.addEventListener("mousedown", onClick, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick, true);
    };
  }, [open]);

  if (!open || !anchor || !editor || !mounted) return null;

  // Position-clamp в viewport. anchor — координата каретки в pixel'ях.
  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  const left = Math.max(8, Math.min(anchor.x, vw - PICKER_WIDTH - 8));
  const top = Math.max(8, Math.min(anchor.y + 8, vh - PICKER_HEIGHT - 8));

  const theme: EmojiTheme =
    resolvedTheme === "dark" ? EmojiThemeEnum.DARK : EmojiThemeEnum.LIGHT;

  const onSelect = (data: EmojiClickData) => {
    try {
      // BN inline-content: text-узел с emoji glyph'ом. У emoji uniccode-
      // характер в .emoji (для скинов 1F44D-1F3FB и т.п. — это уже
      // композитный glyph).
      editor.insertInlineContent(data.emoji);
    } catch (err) {
      console.error("[kb-emoji-picker] insert failed", err);
    }
    closeKbEmojiPicker();
  };

  return createPortal(
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 100,
      }}
      className="rounded-[10px] shadow-lg border border-border overflow-hidden bg-popover"
    >
      <EmojiPicker
        onEmojiClick={onSelect}
        theme={theme}
        width={PICKER_WIDTH}
        height={PICKER_HEIGHT}
        searchPlaceholder="Поиск эмодзи"
        previewConfig={{ showPreview: false }}
        lazyLoadEmojis
        autoFocusSearch
        skinTonesDisabled
      />
    </div>,
    document.body,
  );
}
