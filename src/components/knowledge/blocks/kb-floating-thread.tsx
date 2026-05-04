"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowUp, Loader2 } from "lucide-react";

import { useExtension, useUsers } from "@blocknote/react";
import { CommentsExtension } from "@blocknote/core/comments";
import type {
  CommentData,
  ThreadData,
  User as CommentUser,
} from "@blocknote/core/comments";

import { cn } from "@/lib/utils";

/**
 * Custom Notion-style thread popover. Замена дефолтному `<Thread>` из
 * @blocknote/react через prop `floatingThread={KbFloatingThread}` на
 * `<FloatingThreadController>`. Дефолт BN рендерил голую card'у со
 * стандартным комментом + "Save"-кнопка снизу — выглядит сыро.
 *
 * Здесь — округлая карточка с: avatar + name + relative-time + body
 * для каждого коммента, и Notion-style reply-input снизу
 * (textarea + brand-blue send-button). Поведение Cmd/Ctrl+Enter →
 * submit как в KbFloatingComposer.
 *
 * MVP scope: read + reply. Edit/Delete/Reactions/Resolve пока не
 * добавляем — default BN UI этих функций не было либо они спрятаны
 * за сложными жестами; вернёмся отдельной итерацией.
 */

interface KbFloatingThreadProps {
  thread: ThreadData;
  selected: boolean;
}

export function KbFloatingThread({ thread }: KbFloatingThreadProps) {
  // Подгружаем профили всех уникальных авторов в треде. useUsers под
  // капотом дёргает `resolveUsers` из CommentsExtension config, и
  // подписывается на изменения userStore — когда профиль резолвится,
  // компонент re-render'ится с актуальными данными.
  const userIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of thread.comments) {
      if (!c.deletedAt) set.add(c.userId);
    }
    return Array.from(set);
  }, [thread.comments]);
  const usersMap = useUsers(userIds) as Map<string, CommentUser | undefined>;

  return (
    <div
      className={cn(
        "bn-thread", // KEEP: composer-guard в blocknote-editor.tsx ждёт
        // именно этот класс на root'е, чтобы фиксировать intentional
        // close на click'ах внутри popover'а.
        "rounded-xl border border-border bg-card shadow-md",
        "min-w-[360px] max-w-[440px] overflow-hidden",
      )}
    >
      <div className="flex flex-col max-h-[400px] overflow-y-auto divide-y divide-border/50">
        {thread.comments.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            user={usersMap.get(comment.userId)}
          />
        ))}
      </div>
      <ReplyInput threadId={thread.id} />
    </div>
  );
}

function CommentRow({
  comment,
  user,
}: {
  comment: CommentData;
  user: CommentUser | undefined;
}) {
  if (comment.deletedAt) {
    return (
      <div className="px-3 py-2.5 text-xs italic text-muted-foreground">
        Комментарий удалён
      </div>
    );
  }
  const text = extractCommentText(comment.body);
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5">
      <Avatar user={user} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground truncate">
            {user?.username ?? "..."}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {formatRelative(comment.createdAt)}
          </span>
        </div>
        <div className="text-sm text-foreground leading-snug whitespace-pre-wrap break-words mt-0.5">
          {text || (
            <span className="italic text-muted-foreground">пусто</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ReplyInput({ threadId }: { threadId: string }) {
  const ext = useExtension(CommentsExtension) as unknown as {
    threadStore: {
      addComment: (opts: {
        threadId: string;
        comment: { body: unknown };
      }) => Promise<unknown>;
    };
  };
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sendButtonRef = useRef<HTMLButtonElement | null>(null);

  // Auto-grow textarea up to 120px.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [text]);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    const body = [
      {
        type: "paragraph",
        content: [{ type: "text", text: trimmed, styles: {} }],
      },
    ];
    try {
      await ext.threadStore.addComment({
        threadId,
        comment: { body },
      });
      setText("");
    } catch (err) {
      console.error("[kb-comment] addComment failed", err);
    } finally {
      setSubmitting(false);
    }
  }, [text, submitting, ext, threadId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        // Через synthetic-click — guard в blocknote-editor.tsx ждёт
        // pointerdown/click на `.bn-thread button`. См. Codex #73 P1.
        sendButtonRef.current?.click();
      }
    },
    [],
  );

  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  return (
    <div className="border-t border-border bg-background/50">
      <div className="flex items-end gap-2 p-2.5">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ответить…"
          rows={1}
          disabled={submitting}
          className={cn(
            "flex-1 resize-none bg-transparent outline-none",
            "text-sm text-foreground placeholder:text-muted-foreground",
            "leading-snug py-1",
            "max-h-[120px] overflow-y-auto",
          )}
        />
        <button
          ref={sendButtonRef}
          type="button"
          aria-label="Отправить"
          title="Ответить (⌘↵)"
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
          className={cn(
            "inline-flex items-center justify-center size-7 rounded-full",
            "transition-colors shrink-0",
            canSubmit
              ? "bg-brand text-brand-foreground hover:bg-brand/90"
              : "bg-muted text-muted-foreground cursor-not-allowed",
          )}
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ArrowUp className="size-4" />
          )}
        </button>
      </div>
    </div>
  );
}

function Avatar({ user }: { user: CommentUser | undefined }) {
  const name = user?.username ?? "";
  const initials = getInitials(name);
  if (user?.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatarUrl}
        alt=""
        className="size-7 rounded-full object-cover bg-muted shrink-0"
      />
    );
  }
  return (
    <span className="size-7 rounded-full bg-muted text-muted-foreground inline-flex items-center justify-center text-xs font-semibold shrink-0">
      {initials}
    </span>
  );
}

function getInitials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Walks BN-блок-документ и собирает text-runs в одну строку. Comments
 *  обычно одно-абзацные, но markdown-import / paste теоретически могут
 *  занести несколько blocks — соединяем переносом строки. */
function extractCommentText(body: unknown): string {
  if (!Array.isArray(body)) return "";
  const lines: string[] = [];
  for (const block of body) {
    if (!block || typeof block !== "object") continue;
    const b = block as { content?: unknown };
    if (!Array.isArray(b.content)) continue;
    const parts: string[] = [];
    for (const item of b.content) {
      if (!item || typeof item !== "object") continue;
      const it = item as { type?: string; text?: string };
      if (it.type === "text" && typeof it.text === "string") {
        parts.push(it.text);
      }
    }
    if (parts.length > 0) lines.push(parts.join(""));
  }
  return lines.join("\n");
}

function formatRelative(iso: Date | string): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const diffMs = Date.now() - date.getTime();
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 30) return "только что";
  if (sec < 60) return `${sec} сек`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${plural(days, "день", "дня", "дней")}`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return `${w} ${plural(w, "неделю", "недели", "недель")} назад`;
  }
  // Дальше — DD месяца, YYYY (последнее без «года» если в текущем).
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const formatter = new Intl.DateTimeFormat("ru", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return formatter.format(date);
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
