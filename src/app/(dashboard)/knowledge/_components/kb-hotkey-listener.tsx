"use client";

import { useEffect } from "react";

import { matchKbHotkey, KB_COMMAND_EVENT } from "@/lib/kb-hotkeys";

/**
 * Монтируется один раз в knowledge/layout. Переводит Mod+Shift+буква
 * в CustomEvent("kb:command"). Сам не знает про права/состояние —
 * исполняют подписчики (kb-page-menu, kb-tree-nav). Гард «не в инпуте»
 * не нужен: Mod+Shift-комбо не порождают текст.
 */
export function KbHotkeyListener() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const command = matchKbHotkey(e);
      if (!command) return;
      e.preventDefault();
      window.dispatchEvent(
        new CustomEvent(KB_COMMAND_EVENT, { detail: { command } }),
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
