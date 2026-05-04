"use client";

import { useSyncExternalStore } from "react";

/**
 * Module-level store для open/closed состояния ThreadsSidebar'а.
 *
 * Зачем: toggle-кнопка живёт в `PageHeaderActions` slot'е (server-
 * rendered контейнер в [slug]/page.tsx), а сам sidebar монтируется
 * внутри `BlockNoteView` (renderExtras). Прямой prop-сшивкой не
 * соединить — pattern идентичен kb-editor-store.
 */

const listeners = new Set<() => void>();
let isOpen = false;

export function setKbThreadsSidebarOpen(open: boolean) {
  if (isOpen === open) return;
  isOpen = open;
  for (const l of listeners) l();
}

export function toggleKbThreadsSidebar() {
  setKbThreadsSidebarOpen(!isOpen);
}

export function getKbThreadsSidebarOpen(): boolean {
  return isOpen;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useKbThreadsSidebarOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    getKbThreadsSidebarOpen,
    () => false, // SSR snapshot
  );
}
