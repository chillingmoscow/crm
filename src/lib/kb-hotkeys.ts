/**
 * Чистый матчер хоткеев действий KB-страницы. Без DOM и побочных
 * эффектов — listener (kb-hotkey-listener.tsx) сам делает
 * preventDefault/dispatch. Схема: Mod+Shift+буква (Mod = ⌘ на macOS,
 * Ctrl на остальных). Буквы подобраны без конфликтов с браузером:
 * P (не N — инкогнито), H (не V — вставка без формата).
 */

export type KbCommand =
  | "toggle-lock"
  | "toggle-favorite"
  | "duplicate"
  | "create-page"
  | "version-history";

/** Имя CustomEvent, через которое listener сообщает команду. */
export const KB_COMMAND_EVENT = "kb:command" as const;

const KEY_TO_COMMAND: Record<string, KbCommand> = {
  l: "toggle-lock",
  f: "toggle-favorite",
  d: "duplicate",
  p: "create-page",
  h: "version-history",
};

export function matchKbHotkey(e: {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): KbCommand | null {
  if (e.altKey) return null;
  if (!e.shiftKey) return null;
  if (!e.metaKey && !e.ctrlKey) return null;
  return KEY_TO_COMMAND[e.key.toLowerCase()] ?? null;
}
