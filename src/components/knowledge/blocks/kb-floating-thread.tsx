"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowUp,
  Check,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  SmilePlus,
  Trash2,
} from "lucide-react";

import { useExtension, useUsers } from "@blocknote/react";
import { CommentsExtension } from "@blocknote/core/comments";
import type {
  CommentData,
  ThreadData,
  User as CommentUser,
} from "@blocknote/core/comments";

import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Custom Notion-style thread popover с поддержкой:
 *   • read + reply (как раньше)
 *   • Edit/Delete каждого коммента (⋯-меню при hover, gating по
 *     `threadStore.auth.canUpdateComment` / `canDeleteComment`)
 *   • Resolve / unresolve тред (галочка-toggle в шапке)
 *   • Reactions — фикс-набор 6 эмодзи (👍 ❤️ 😂 🎉 ✅ 👀), badge'и
 *     с счётчиками; click добавляет/убирает реакцию текущего юзера.
 *
 * Wrapper всё ещё имеет `className="bn-thread"` — это критично для
 * composer-guard в blocknote-editor.tsx (он мониторит фокус именно
 * по этому селектору, чтобы не закрыть popover при click'е внутрь).
 */

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "✅", "👀"] as const;

interface ThreadStoreLike {
  auth: {
    canUpdateComment: (c: CommentData) => boolean;
    canDeleteComment: (c: CommentData) => boolean;
    canResolveThread: (t: ThreadData) => boolean;
    canUnresolveThread: (t: ThreadData) => boolean;
    canAddReaction: (c: CommentData, emoji?: string) => boolean;
    canDeleteReaction: (c: CommentData, emoji?: string) => boolean;
  };
  addComment: (opts: {
    threadId: string;
    comment: { body: unknown };
  }) => Promise<unknown>;
  updateComment: (opts: {
    commentId: string;
    threadId: string;
    comment: { body: unknown };
  }) => Promise<unknown>;
  deleteComment: (opts: {
    threadId: string;
    commentId: string;
  }) => Promise<unknown>;
  resolveThread: (opts: { threadId: string }) => Promise<unknown>;
  unresolveThread: (opts: { threadId: string }) => Promise<unknown>;
  addReaction: (opts: {
    threadId: string;
    commentId: string;
    emoji: string;
  }) => Promise<unknown>;
  deleteReaction: (opts: {
    threadId: string;
    commentId: string;
    emoji: string;
  }) => Promise<unknown>;
}

interface CommentsExtensionLike {
  threadStore: ThreadStoreLike;
}

interface KbFloatingThreadProps {
  thread: ThreadData;
  selected: boolean;
}

export function KbFloatingThread({ thread }: KbFloatingThreadProps) {
  const ext = useExtension(CommentsExtension) as unknown as CommentsExtensionLike;
  const store = ext.threadStore;

  const userIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of thread.comments) {
      if (!c.deletedAt) set.add(c.userId);
    }
    return Array.from(set);
  }, [thread.comments]);
  const usersMap = useUsers(userIds) as Map<string, CommentUser | undefined>;

  const canResolve = thread.resolved
    ? store.auth.canUnresolveThread(thread)
    : store.auth.canResolveThread(thread);

  const handleResolveToggle = useCallback(async () => {
    try {
      if (thread.resolved) {
        await store.unresolveThread({ threadId: thread.id });
      } else {
        await store.resolveThread({ threadId: thread.id });
      }
    } catch (err) {
      console.error("[kb-comment] resolve toggle failed", err);
    }
  }, [thread, store]);

  return (
    <div
      className={cn(
        "bn-thread",
        "rounded-xl border border-border bg-card shadow-md",
        "min-w-[360px] max-w-[440px] overflow-hidden",
      )}
    >
      {/* Header — resolve toggle. При resolved ещё показываем статус
          курсивом для контекста. */}
      {(canResolve || thread.resolved) && (
        <div
          className={cn(
            "flex items-center justify-between px-3 py-1.5 border-b border-border",
            thread.resolved
              ? "bg-emerald-50/60 dark:bg-emerald-900/20"
              : "bg-background/60",
          )}
        >
          <span
            className={cn(
              "text-[11px] font-medium",
              thread.resolved
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-muted-foreground",
            )}
          >
            {thread.resolved ? "Решено" : "Обсуждение"}
          </span>
          {canResolve && (
            <button
              type="button"
              onClick={() => void handleResolveToggle()}
              title={thread.resolved ? "Открыть заново" : "Отметить как решённое"}
              className={cn(
                "inline-flex items-center gap-1 px-1.5 h-6 rounded-md text-[11px] font-medium",
                "transition-colors",
                thread.resolved
                  ? "text-muted-foreground hover:bg-accent"
                  : "text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/40",
              )}
            >
              {thread.resolved ? (
                <>
                  <RotateCcw className="size-3" />
                  Открыть
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-3" />
                  Решить
                </>
              )}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col max-h-[400px] overflow-y-auto divide-y divide-border/50">
        {thread.comments.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            user={usersMap.get(comment.userId)}
            store={store}
            threadId={thread.id}
          />
        ))}
      </div>
      <ReplyInput threadId={thread.id} store={store} />
    </div>
  );
}

function CommentRow({
  comment,
  user,
  store,
  threadId,
}: {
  comment: CommentData;
  user: CommentUser | undefined;
  store: ThreadStoreLike;
  threadId: string;
}) {
  const [editing, setEditing] = useState(false);
  if (comment.deletedAt) {
    return (
      <div className="px-3 py-2.5 text-xs italic text-muted-foreground">
        Комментарий удалён
      </div>
    );
  }
  const text = extractCommentText(comment.body);
  const canEdit = store.auth.canUpdateComment(comment);
  const canDelete = store.auth.canDeleteComment(comment);

  if (editing) {
    return (
      <EditCommentRow
        comment={comment}
        user={user}
        threadId={threadId}
        initialText={text}
        store={store}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="group flex items-start gap-2.5 px-3 py-2.5 relative">
      <Avatar user={user} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground truncate">
            {user?.username ?? "..."}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {formatRelative(comment.createdAt)}
            {comment.updatedAt &&
              comment.updatedAt.getTime() !== comment.createdAt.getTime() &&
              " (изменён)"}
          </span>
        </div>
        <div className="text-sm text-foreground leading-snug whitespace-pre-wrap break-words mt-0.5">
          {text || (
            <span className="italic text-muted-foreground">пусто</span>
          )}
        </div>
        <Reactions comment={comment} store={store} threadId={threadId} />
      </div>
      <CommentActions
        canEdit={canEdit}
        canDelete={canDelete}
        canReact={store.auth.canAddReaction(comment)}
        commentId={comment.id}
        threadId={threadId}
        store={store}
        onEdit={() => setEditing(true)}
      />
    </div>
  );
}

function CommentActions({
  canEdit,
  canDelete,
  canReact,
  commentId,
  threadId,
  store,
  onEdit,
}: {
  canEdit: boolean;
  canDelete: boolean;
  canReact: boolean;
  commentId: string;
  threadId: string;
  store: ThreadStoreLike;
  onEdit: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);

  const handleDelete = useCallback(async () => {
    setMenuOpen(false);
    try {
      await store.deleteComment({ threadId, commentId });
    } catch (err) {
      console.error("[kb-comment] deleteComment failed", err);
    }
  }, [store, threadId, commentId]);

  const handleReact = useCallback(
    async (emoji: string) => {
      setReactOpen(false);
      try {
        await store.addReaction({ threadId, commentId, emoji });
      } catch (err) {
        console.error("[kb-comment] addReaction failed", err);
      }
    },
    [store, threadId, commentId],
  );

  if (!canEdit && !canDelete && !canReact) return null;

  return (
    <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      {canReact && (
        <Popover open={reactOpen} onOpenChange={setReactOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Добавить реакцию"
              className="inline-flex items-center justify-center size-6 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <SmilePlus className="size-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-1.5" sideOffset={4} align="end">
            <div className="flex items-center gap-0.5">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => void handleReact(emoji)}
                  className="size-7 rounded-md hover:bg-accent text-base leading-none transition-colors"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
      {(canEdit || canDelete) && (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Действия"
              className="inline-flex items-center justify-center size-6 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-40 p-1" sideOffset={4} align="end">
            <ul className="flex flex-col gap-px">
              {canEdit && (
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onEdit();
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent text-left"
                  >
                    <Pencil className="size-3.5 text-muted-foreground" />
                    Изменить
                  </button>
                </li>
              )}
              {canDelete && (
                <li>
                  <button
                    type="button"
                    onClick={() => void handleDelete()}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-destructive/10 text-destructive text-left"
                  >
                    <Trash2 className="size-3.5" />
                    Удалить
                  </button>
                </li>
              )}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function Reactions({
  comment,
  store,
  threadId,
}: {
  comment: CommentData;
  store: ThreadStoreLike;
  threadId: string;
}) {
  if (!comment.reactions || comment.reactions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 mt-1.5">
      {comment.reactions.map((r) => {
        const canRemove = store.auth.canDeleteReaction(comment, r.emoji);
        const canAdd = store.auth.canAddReaction(comment, r.emoji);
        const isMine = !canAdd && canRemove; // обратная логика BN-default
        const handleClick = async () => {
          try {
            if (isMine) {
              await store.deleteReaction({
                threadId,
                commentId: comment.id,
                emoji: r.emoji,
              });
            } else if (canAdd) {
              await store.addReaction({
                threadId,
                commentId: comment.id,
                emoji: r.emoji,
              });
            }
          } catch (err) {
            console.error("[kb-comment] reaction toggle failed", err);
          }
        };
        return (
          <button
            key={r.emoji}
            type="button"
            onClick={() => void handleClick()}
            disabled={!canAdd && !canRemove}
            className={cn(
              "inline-flex items-center gap-1 h-6 px-1.5 rounded-md border text-[12px] transition-colors",
              isMine
                ? "bg-brand/10 border-brand/40 text-brand hover:bg-brand/15"
                : "bg-muted/50 border-border hover:bg-accent",
            )}
          >
            <span className="text-sm leading-none">{r.emoji}</span>
            <span className="font-medium tabular-nums">
              {r.userIds.length}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function EditCommentRow({
  comment,
  user,
  threadId,
  initialText,
  store,
  onDone,
}: {
  comment: CommentData;
  user: CommentUser | undefined;
  threadId: string;
  initialText: string;
  store: ThreadStoreLike;
  onDone: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    // Курсор в конец.
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
  }, []);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [text]);

  const handleSave = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || saving) {
      onDone();
      return;
    }
    if (trimmed === initialText.trim()) {
      onDone();
      return;
    }
    setSaving(true);
    const body = [
      {
        type: "paragraph",
        content: [{ type: "text", text: trimmed, styles: {} }],
      },
    ];
    try {
      await store.updateComment({
        commentId: comment.id,
        threadId,
        comment: { body },
      });
      onDone();
    } catch (err) {
      console.error("[kb-comment] updateComment failed", err);
      setSaving(false);
    }
  }, [text, saving, initialText, store, comment.id, threadId, onDone]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveButtonRef.current?.click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onDone();
    }
  };

  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 bg-accent/30">
      <Avatar user={user} />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground truncate">
            {user?.username ?? "..."}
          </span>
          <span className="text-[11px] text-muted-foreground">
            редактирование
          </span>
        </div>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={saving}
          className={cn(
            "w-full resize-none bg-background outline-none rounded-md border border-input px-2 py-1.5",
            "text-sm text-foreground leading-snug",
            "focus:ring-2 focus:ring-ring focus:ring-offset-0",
          )}
        />
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={onDone}
            disabled={saving}
            className="px-2 h-7 rounded-md text-xs text-muted-foreground hover:bg-accent transition-colors"
          >
            Отмена
          </button>
          <button
            ref={saveButtonRef}
            type="button"
            onClick={() => void handleSave()}
            disabled={!text.trim() || saving}
            className={cn(
              "inline-flex items-center justify-center size-7 rounded-full transition-colors",
              text.trim() && !saving
                ? "bg-brand text-brand-foreground hover:bg-brand/90"
                : "bg-muted text-muted-foreground cursor-not-allowed",
            )}
            title="Сохранить (⌘↵)"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReplyInput({
  threadId,
  store,
}: {
  threadId: string;
  store: ThreadStoreLike;
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sendButtonRef = useRef<HTMLButtonElement | null>(null);

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
      await store.addComment({
        threadId,
        comment: { body },
      });
      setText("");
    } catch (err) {
      console.error("[kb-comment] addComment failed", err);
    } finally {
      setSubmitting(false);
    }
  }, [text, submitting, store, threadId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
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
