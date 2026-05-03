"use client";

import { useSyncExternalStore } from "react";
import type { BlockNoteEditor } from "@blocknote/core";

/**
 * Module-level store для текущего активного KB-редактора.
 *
 * Зачем (та же мотивация что у kb-save-status.tsx): кнопки Undo/Redo
 * живут в KB-топбаре (`PageHeaderActions` слот в layout'е), а сам
 * редактор монтируется глубоко в `KbPageEditor`. Прямо передать
 * editor instance через props невозможно — топбар отрисовывается
 * server-side в [slug]/page.tsx, а editor — client-only dynamic
 * import.
 *
 * Решение: editor сам себя регистрирует при mount'е через
 * `setKbEditor(editor)` (см. KbPageEditor.renderExtras), кнопки
 * подписываются через `useKbEditor()`. Reset при unmount —
 * setKbEditor(null).
 */

const listeners = new Set<() => void>();
let currentEditor: BlockNoteEditor | null = null;

export function setKbEditor(editor: BlockNoteEditor | null) {
  if (currentEditor === editor) return;
  currentEditor = editor;
  for (const l of listeners) l();
}

export function getKbEditor(): BlockNoteEditor | null {
  return currentEditor;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useKbEditor(): BlockNoteEditor | null {
  return useSyncExternalStore(subscribe, getKbEditor, getKbEditor);
}
