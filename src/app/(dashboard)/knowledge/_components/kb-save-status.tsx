"use client";

import { useSyncExternalStore } from "react";
import { Loader2, Cloud, CloudOff, AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Глобальный store для save-state KB-редактора.
 *
 * Зачем: badge «Сохранено · 12:34» живёт в KB-топбаре (далеко от
 * редактора в дереве), а его обновления не должны пересчитывать
 * сам редактор. Раньше save-state был useState внутри KbPageEditor —
 * каждое обновление триггерило render BlockNoteView, что закрывало
 * формат-toolbar и slash-menu прямо во время взаимодействия.
 *
 * Решение: module-level state + useSyncExternalStore. KbPageEditor
 * только пишет (setKbSaveState) и не подписывается → его render-цикл
 * больше не зависит от частоты save-событий. Badge подписывается и
 * перерисовывается изолированно.
 *
 * Reset on page change — см. KbPageEditor (effect по pageId).
 */

export type KbSaveState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "error"; message: string };

const listeners = new Set<() => void>();
let currentState: KbSaveState = { kind: "idle" };

export function setKbSaveState(next: KbSaveState) {
  currentState = next;
  for (const l of listeners) l();
}

export function getKbSaveState(): KbSaveState {
  return currentState;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useKbSaveState(): KbSaveState {
  return useSyncExternalStore(subscribe, getKbSaveState, getKbSaveState);
}

/** Badge for the KB top-bar. Подписывается на module store, поэтому
 *  re-render идёт только сюда — редактор остаётся стабильным. */
export function KbSaveStatusBadge() {
  const state = useKbSaveState();

  if (state.kind === "idle") {
    // Резервируем место чтобы соседние кнопки не «дышали» при
    // появлении/исчезновении бейджа. h-7 совпадает с высотой badge.
    return <div className="h-7 w-px" aria-hidden="true" />;
  }

  if (state.kind === "pending") {
    return (
      <Badge tone="muted">
        <CloudOff className="size-3.5" />
        Не сохранено
      </Badge>
    );
  }

  if (state.kind === "saving") {
    return (
      <Badge tone="muted">
        <Loader2 className="size-3.5 animate-spin" />
        Сохраняем…
      </Badge>
    );
  }

  if (state.kind === "saved") {
    return (
      <Badge tone="muted">
        <Cloud className="size-3.5" />
        Сохранено · {formatTime(state.at)}
      </Badge>
    );
  }

  return (
    <Badge tone="error">
      <AlertTriangle className="size-3.5" />
      Ошибка сохранения
    </Badge>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "muted" | "error";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs whitespace-nowrap",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "error" && "bg-destructive/10 text-destructive",
      )}
    >
      {children}
    </span>
  );
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
