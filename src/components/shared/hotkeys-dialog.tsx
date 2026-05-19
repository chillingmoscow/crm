"use client";

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { HOTKEY_GROUPS } from "@/lib/hotkeys";

// ─── kbd-чип ──────────────────────────────────────────────────────
// Стиль скопирован с хинта в меню профиля (sidebar.tsx) — единый вид
// клавиш по всему приложению.

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[20px] items-center justify-center px-1.5 py-px rounded-[4px] bg-muted border border-border text-[11px] font-semibold text-muted-foreground font-mono">
      {children}
    </kbd>
  );
}

/** Mod → ⌘ на macOS, Ctrl — на остальных. Остальные токены как есть. */
function renderToken(token: string, isMac: boolean): string {
  if (token === "Mod") return isMac ? "⌘" : "Ctrl";
  if (token === "Shift") return isMac ? "⇧" : "Shift";
  if (token === "Enter") return isMac ? "⏎" : "Enter";
  return token;
}

function HotkeysDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [isMac, setIsMac] = useState(false);
  // navigator доступен только в браузере — детектим после маунта,
  // чтобы избежать SSR-mismatch (приём из kb-search-dialog).
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent));
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-xl p-7">
        <DialogHeader>
          <DialogTitle>Горячие клавиши</DialogTitle>
          <DialogDescription>
            Сочетания клавиш для быстрой работы. На Windows/Linux вместо ⌘
            используется Ctrl.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 flex flex-col gap-6">
          {HOTKEY_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h3>
              <ul className="flex flex-col">
                {group.entries.map((entry, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-4 border-b border-border/60 py-2 last:border-b-0"
                  >
                    <span className="text-[13px]">{entry.description}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {entry.keys.map((token, k) => (
                        <Kbd key={k}>{renderToken(token, isMac)}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Монтируется один раз в dashboard-layout. Открывает справку:
 *  ─ по `Shift + ?` (e.key === "?" — на большинстве раскладок это уже
 *    подразумевает Shift), с гардом против срабатывания при вводе
 *    текста;
 *  ─ по window-событию `hotkeys:open` — его диспатчит кнопка
 *    «Горячие клавиши» в меню профиля (sidebar.tsx).
 * Закрытие — штатно через Radix Dialog (Esc / клик по фону / X).
 */
export function HotkeysDialogProvider() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?") return;
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      e.preventDefault();
      setOpen((prev) => !prev);
    };
    const onOpenEvent = () => setOpen(true);

    window.addEventListener("keydown", onKey);
    window.addEventListener("hotkeys:open", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("hotkeys:open", onOpenEvent);
    };
  }, []);

  return <HotkeysDialog open={open} onOpenChange={setOpen} />;
}
