"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  buildCommentBodyFromText,
  useCommentMentionDropdown,
  type KbCommentMention,
} from "@/components/knowledge/blocks/kb-comment-mention-dropdown";

interface PageCommentComposerProps {
  currentUserName: string | null;
  currentUserAvatarUrl: string | null;
  /** Notion-style placeholder (нижняя пустая «Add a comment…»). */
  placeholder?: string;
  /** Initial-text для edit-mode: кому-то надо отредактировать существующий
   *  комментарий. Compose'ер тогда стартует с заполненной textarea. */
  initialText?: string;
  initialMentions?: KbCommentMention[];
  /** Открыт сразу (для edit) — фокусируется на mount. */
  autoFocus?: boolean;
  /** Submit handler. Возвращает Promise; пока ждём — submitting=true. */
  onSubmit: (body: unknown[]) => Promise<void>;
  /** Optional: вернуться к чтению (cancel в edit-mode). */
  onCancel?: () => void;
}

/**
 * Composer для page-level комментариев. Аналогичный по логике
 * `<KbFloatingComposer>`, но без зависимости от BlockNote ThreadStore
 * (live'ёт ВНЕ редактора). Reuse'ит `useCommentMentionDropdown` и
 * `buildCommentBodyFromText` для @-mentions.
 *
 * Visual model:
 *   ┌────┐  textarea (auto-grow, max 160px)         [▲ send]
 *   │ AV │  «Написать комментарий…»                 (brand
 *   └────┘                                            когда есть текст)
 */
export function PageCommentComposer({
  currentUserName,
  currentUserAvatarUrl,
  placeholder = "Написать комментарий…",
  initialText = "",
  initialMentions,
  autoFocus,
  onSubmit,
  onCancel,
}: PageCommentComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState(initialText);
  const [submitting, setSubmitting] = useState(false);

  const { mentions, dropdown, handleKeyDown: handleMentionKeyDown, resetMentions } =
    useCommentMentionDropdown({
      textareaRef,
      text,
      setText,
      initialMentions,
    });

  // Auto-focus в edit-mode (initialText передан) или по флагу autoFocus.
  useEffect(() => {
    if (!autoFocus) return;
    const ta = textareaRef.current;
    if (!ta) return;
    try {
      ta.focus({ preventScroll: true });
    } catch {
      ta.focus();
    }
    // Caret в конец текста — типичное ожидание при «продолжить редактирование».
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
  }, [autoFocus]);

  // Auto-grow.
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
    try {
      const body = buildCommentBodyFromText(trimmed, mentions);
      await onSubmit(body);
      setText("");
      resetMentions();
    } catch (err) {
      // onSubmit сам логирует / показывает toast'ы.
      console.error("[page-comment] submit failed", err);
    } finally {
      setSubmitting(false);
    }
  }, [text, mentions, submitting, onSubmit, resetMentions]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (handleMentionKeyDown(e)) return;
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void handleSubmit();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (onCancel) onCancel();
      }
    },
    [handleMentionKeyDown, handleSubmit, onCancel],
  );

  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && !submitting;
  const initials = getInitials(currentUserName);

  return (
    <div className="flex items-start gap-2">
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
      <div className="flex-1 min-w-0 flex flex-col gap-1.5 rounded-xl border border-border bg-card px-3 py-2 focus-within:border-brand transition-colors">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={submitting}
          className={cn(
            "w-full resize-none bg-transparent outline-none",
            "text-sm text-foreground placeholder:text-muted-foreground",
            "leading-snug py-0.5",
            "max-h-40 overflow-y-auto",
          )}
        />
        <div className="flex items-center justify-end gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Отмена
            </button>
          )}
          <button
            type="button"
            aria-label="Отправить"
            data-tip="Отправить (⌘↵)"
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
            className={cn(
              "inline-flex items-center justify-center size-7 rounded-full transition-colors",
              canSubmit
                ? "bg-brand text-brand-foreground hover:bg-brand/90"
                : "bg-muted text-muted-foreground cursor-not-allowed",
            )}
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </div>
      {dropdown}
    </div>
  );
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
