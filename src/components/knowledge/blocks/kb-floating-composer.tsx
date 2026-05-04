"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";

import {
  useBlockNoteEditor,
  useExtension,
} from "@blocknote/react";
import { CommentsExtension } from "@blocknote/core/comments";

import { cn } from "@/lib/utils";
import { flushAllPendingSaves } from "@/lib/knowledge/pending-saves";

/**
 * Custom Notion-style floating composer для KB-комментариев. Заменяет
 * дефолтный BlockNote'овский `<FloatingComposer>` через prop
 * `floatingComposer={KbFloatingComposer}` на `<FloatingComposerController>`.
 *
 * Дефолт BN (`y` в FloatingComposerController-BaABZYUN.js) рендерит
 * голый прямоугольник с placeholder'ом и кнопкой «Save» — некрасиво,
 * не вписывается в дизайн. Здесь — округлая карточка с avatar'ом
 * автора слева, textarea-полем для ввода и round send-button'ом
 * (стрелка вверх, brand-blue когда есть текст, muted когда пусто).
 *
 * Backend остаётся без изменений: на submit вызываем
 * `commentsExt.createThread({ initialComment: { body } })` — тот же
 * API, что зовёт дефолтный composer. SupabaseThreadStore не трогаем.
 *
 * `className="bn-thread"` на root'е — НАМЕРЕННО: существующий
 * FloatingComposer-guard в `blocknote-editor.tsx` mонитоrит фокус
 * именно по этому селектору (.bn-thread / .bn-comment-editor) для
 * детектирования spurious blur'ов и intentional close'ов через клик
 * на кнопку. Без него composer закрывается при клике в textarea.
 */

interface KbFloatingComposerProps {
  /** Имя current user — для подписи аватарки fallback'а (initials). */
  currentUserName: string | null;
  /** URL аватарки — если null, рендерим круг с инициалами. */
  currentUserAvatarUrl: string | null;
}

export function KbFloatingComposer({
  currentUserName,
  currentUserAvatarUrl,
}: KbFloatingComposerProps) {
  const editor = useBlockNoteEditor();
  const ext = useExtension(CommentsExtension) as unknown as {
    createThread: (opts: {
      initialComment: { body: unknown };
    }) => Promise<unknown>;
    stopPendingComment: () => void;
  };

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sendButtonRef = useRef<HTMLButtonElement | null>(null);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Auto-focus + auto-grow.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [text]);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    // BN-блок: один paragraph с inline text-run'ом. Совпадает по
    // shape с тем, что генерирует BN'овский useCreateBlockNote с
    // одним абзацем — SupabaseThreadStore хранит как jsonb, рендер
    // на чтении использует BN'овский Comment-component.
    const body = [
      {
        type: "paragraph",
        content: [{ type: "text", text: trimmed, styles: {} }],
      },
    ];
    try {
      await ext.createThread({ initialComment: { body } });
      // КРИТИЧНО: createThread ВНУТРИ TipTap'а добавляет comment-mark
      // на selection через editor.transact → editor.onChange
      // → scheduleSave (debounce 2s). Если юзер reload'ит страницу
      // в течение этих 2 секунд, mark'а в kb_pages.content нет, и
      // на след. загрузке тред становится «orphan» (BN рисует его
      // как `data-orphan="true"`, gutter-индикатор скрывает,
      // popover не открыть). Force-flush снимает гонку — save
      // улетает синхронно сразу после создания thread'а.
      await flushAllPendingSaves();
      ext.stopPendingComment();
      // Возвращаем focus в outer editor — иначе он остаётся на нашем
      // (уже unmount'ed) textarea и keyboard input уходит в body.
      (editor as unknown as { focus: () => void }).focus();
    } catch (err) {
      console.error("[kb-comment] createThread failed", err);
      setSubmitting(false);
    }
  }, [text, submitting, ext, editor]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Cmd/Ctrl+Enter → submit. КРИТИЧНО синтетически кликнуть по
      // send-button'у, а не звать handleSubmit напрямую: guard в
      // blocknote-editor.tsx маркирует intentional-close флаг при
      // pointerdown/click внутри `.bn-thread button`. Если позвать
      // submit без этого, stopPendingComment блокируется guard'ом,
      // composer остаётся открытым с submitting=true. См. Codex #73 P1.
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        sendButtonRef.current?.click();
        return;
      }
      // Escape — guard сам слушает keydown в capture phase и
      // устанавливает intentionalClose, поэтому stopPendingComment
      // отработает корректно.
      if (e.key === "Escape") {
        e.preventDefault();
        ext.stopPendingComment();
        (editor as unknown as { focus: () => void }).focus();
      }
    },
    [ext, editor],
  );

  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && !submitting;
  const initials = getInitials(currentUserName);

  return (
    <div
      className={cn(
        "bn-thread",
        "rounded-xl border border-border bg-card shadow-md",
        "min-w-[320px] max-w-[420px]",
      )}
    >
      <div className="flex items-start gap-2 p-2.5">
        {/* Avatar slot */}
        {currentUserAvatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentUserAvatarUrl}
            alt=""
            className="size-7 rounded-full object-cover bg-muted shrink-0"
          />
        ) : (
          <span className="size-7 rounded-full bg-muted text-muted-foreground inline-flex items-center justify-center text-xs font-semibold shrink-0">
            {initials}
          </span>
        )}

        {/* Input + actions */}
        <div className="flex-1 flex flex-col gap-1.5 min-w-0">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Написать комментарий…"
            rows={1}
            disabled={submitting}
            className={cn(
              "w-full resize-none bg-transparent outline-none",
              "text-sm text-foreground placeholder:text-muted-foreground",
              "leading-snug py-1",
              "max-h-40 overflow-y-auto",
            )}
          />
          <div className="flex items-center justify-end gap-1">
            <button
              ref={sendButtonRef}
              type="button"
              aria-label="Отправить"
              title="Отправить (⌘↵)"
              disabled={!canSubmit}
              onClick={() => void handleSubmit()}
              className={cn(
                "inline-flex items-center justify-center size-7 rounded-full",
                "transition-colors",
                canSubmit
                  ? "bg-brand text-brand-foreground hover:bg-brand/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed",
              )}
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
