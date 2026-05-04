"use client";

import { useEffect, useState } from "react";
import { Undo2, Redo2 } from "lucide-react";
import { undoDepth, redoDepth } from "prosemirror-history";

import { IconTooltip } from "@/components/ui/icon-tooltip";
import { useKbEditor } from "@/app/(dashboard)/knowledge/_components/kb-editor-store";

/**
 * Undo / Redo кнопки для KB-топбара.
 *
 * BlockNote поверх ProseMirror уже имеет работающие Ctrl+Z / Ctrl+Shift+Z
 * через `HistoryExtension` — но видимых кнопок не было, и пользователи
 * не подозревают, что undo возможен. Эти две иконки — discoverability-
 * слой, делегируют в `editor.undo()` / `editor.redo()`.
 *
 * Состояние enabled/disabled берётся из ProseMirror history-плагина
 * (`undoDepth(state) > 0`) — пересчитывается на каждый `editor.onChange`.
 *
 * На locked-странице (`canEdit=false`) кнопки остаются ВИДНЫ, но
 * disabled — иначе после блокировки toolbar «прыгает» (две кнопки
 * пропадают), а юзеру всё ещё полезно видеть, что undo/redo концептуально
 * существуют. Render возвращает null только пока editor не зарегистрирован
 * в store (mount race до маунта BN-инстанса).
 */
export function KbUndoRedoButtons({ canEdit }: { canEdit: boolean }) {
  const editor = useKbEditor();
  // Tick переключается на каждый editor.onChange → форсирует re-render,
  // чтобы пересчитать undoDepth/redoDepth. Это лёгкий компонент (две
  // кнопки), 60-fps re-render во время typing — не проблема.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const unsubscribe = editor.onChange(() => setTick((t) => t + 1));
    return unsubscribe;
  }, [editor]);

  if (!editor) return null;

  // `_tiptapEditor.state` — ProseMirror EditorState. `undoDepth`/
  // `redoDepth` — из прямой dep `prosemirror-history` (BlockNote'овский
  // HistoryExtension работает поверх неё же).
  const state = editor._tiptapEditor.state;
  const undoEnabled = canEdit && undoDepth(state) > 0;
  const redoEnabled = canEdit && redoDepth(state) > 0;

  return (
    <>
      <IconTooltip
        label={canEdit ? "Отменить (Ctrl+Z)" : "Отмена недоступна на заблокированной странице"}
      >
        <button
          type="button"
          aria-label="Отменить"
          onClick={() => editor.undo()}
          disabled={!undoEnabled}
          className="inline-flex items-center justify-center size-9 rounded-lg bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-background disabled:hover:text-muted-foreground"
        >
          <Undo2 className="w-[18px] h-[18px]" />
        </button>
      </IconTooltip>
      <IconTooltip
        label={canEdit ? "Вернуть (Ctrl+Shift+Z)" : "Повтор недоступен на заблокированной странице"}
      >
        <button
          type="button"
          aria-label="Вернуть"
          onClick={() => editor.redo()}
          disabled={!redoEnabled}
          className="inline-flex items-center justify-center size-9 rounded-lg bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-background disabled:hover:text-muted-foreground"
        >
          <Redo2 className="w-[18px] h-[18px]" />
        </button>
      </IconTooltip>
    </>
  );
}
