"use client";

import { useMemo, useState } from "react";
import { MoreHorizontal, Pencil, SmilePlus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  extractMentionsFromCommentBody,
} from "@/components/knowledge/blocks/kb-comment-mention-dropdown";
import {
  type PageComment,
  togglePageCommentReaction,
  updatePageComment,
  deletePageComment,
} from "@/lib/knowledge/page-comments";
import { CommentBodyRenderer, extractPlainText } from "./comment-body-renderer";
import { PageCommentComposer } from "./page-comment-composer";

interface PageCommentUser {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

interface PageCommentItemProps {
  comment: PageComment;
  /** Resolved авторская инфа. `null` если не нашли (placeholder). */
  author: PageCommentUser | null;
  currentUserId: string;
  /** Может ли юзер реагировать / комментировать. */
  canComment: boolean;
  /** Editor-permission: может удалять чужие comments / threads.
   *  Reserved для будущей админ-операции — в MVP delete только для
   *  автора (через action menu ниже). */
  canEdit?: boolean;
  currentUserName: string | null;
  currentUserAvatarUrl: string | null;
  /** Optimistic-update коллбэки от родительского контейнера. */
  onLocalUpdate: (commentId: string, body: unknown[]) => void;
  onLocalDelete: (commentId: string) => void;
  /** Откатить optimistic delete (RPC упала, deletedAt → null). */
  onLocalRestore: (commentId: string) => void;
  onLocalReact: (commentId: string, emoji: string, add: boolean) => void;
}

const QUICK_EMOJIS = ["👍", "❤️", "🎉", "👀", "😄", "🙌"];

/**
 * Один page-level comment в ленте.
 *
 * Layout:
 *   ┌────┐  Имя автора · 5m ago                  [⋯]
 *   │ AV │  Текст комментария с @-mention'ами
 *   └────┘  [👍 2]  [❤️ 1]  [+]
 *
 * Действия:
 *   • [⋯] меню: «Изменить» (только автор), «Удалить» (только автор)
 *   • [+] react: popover с QUICK_EMOJIS
 *   • Клик по существующему reaction-chip'у: toggle для current user
 *
 * Soft-deleted comment рендерится как tombstone «Комментарий удалён».
 */
export function PageCommentItem({
  comment,
  author,
  currentUserId,
  canComment,
  currentUserName,
  currentUserAvatarUrl,
  onLocalUpdate,
  onLocalDelete,
  onLocalRestore,
  onLocalReact,
}: PageCommentItemProps) {
  const [editing, setEditing] = useState(false);

  const isAuthor = comment.authorId === currentUserId;

  const initialMentions = useMemo(
    () => extractMentionsFromCommentBody(comment.body),
    [comment.body],
  );
  const initialText = useMemo(
    () => extractPlainText(comment.body),
    [comment.body],
  );

  if (comment.deletedAt) {
    return (
      <div className="flex items-start gap-2">
        <span className="size-7 rounded-full bg-muted shrink-0" />
        <div className="flex-1 min-w-0 text-sm italic text-muted-foreground py-1">
          Комментарий удалён
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <PageCommentComposer
        currentUserName={currentUserName}
        currentUserAvatarUrl={currentUserAvatarUrl}
        initialText={initialText}
        initialMentions={initialMentions}
        autoFocus
        onSubmit={async (body) => {
          await updatePageComment({ commentId: comment.id, body });
          onLocalUpdate(comment.id, body);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const authorName = author?.fullName ?? "Удалённый пользователь";
  const authorAvatar = author?.avatarUrl ?? null;
  const initials = getInitials(authorName);

  return (
    <div className="group flex items-start gap-2">
      {authorAvatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={authorAvatar}
          alt=""
          className="size-7 rounded-full object-cover bg-muted shrink-0"
        />
      ) : (
        <span className="size-7 rounded-full bg-muted text-muted-foreground inline-flex items-center justify-center text-xs font-semibold shrink-0">
          {initials}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-foreground truncate">
            {authorName}
          </span>
          <span
            className="text-xs text-muted-foreground shrink-0"
            data-tip={new Date(comment.createdAt).toLocaleString()}
          >
            {formatRelative(comment.createdAt)}
          </span>
          {comment.updatedAt !== comment.createdAt && (
            <span
              className="text-xs text-muted-foreground/70 shrink-0"
              data-tip={`Изменён ${new Date(comment.updatedAt).toLocaleString()}`}
            >
              · изменён
            </span>
          )}
          {/* Action-меню справа, видимо на hover (как в Notion). */}
          <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {canComment && (
              <ReactPopover
                onPick={async (emoji) => {
                  const userIds = comment.reactions[emoji] ?? [];
                  const already = userIds.includes(currentUserId);
                  if (already) return;
                  onLocalReact(comment.id, emoji, true);
                  try {
                    await togglePageCommentReaction({
                      commentId: comment.id,
                      emoji,
                      add: true,
                    });
                  } catch (err) {
                    console.error("[page-comment] react failed", err);
                    onLocalReact(comment.id, emoji, false); // rollback
                  }
                }}
              />
            )}
            {isAuthor && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Действия с комментарием"
                    className="inline-flex items-center justify-center size-6 rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    <Pencil className="size-4 mr-2" />
                    Изменить
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={async () => {
                      // Optimistic tombstone → откат при ошибке RPC,
                      // иначе юзер видит «удалён» хотя в БД жив.
                      onLocalDelete(comment.id);
                      try {
                        await deletePageComment({
                          commentId: comment.id,
                          threadId: comment.threadId,
                        });
                      } catch (err) {
                        console.error("[page-comment] delete failed", err);
                        onLocalRestore(comment.id);
                      }
                    }}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="size-4 mr-2" />
                    Удалить
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        <div className="text-sm text-foreground">
          <CommentBodyRenderer body={comment.body} />
        </div>
        <ReactionRow
          reactions={comment.reactions}
          currentUserId={currentUserId}
          canReact={canComment}
          onToggle={async (emoji, add) => {
            onLocalReact(comment.id, emoji, add);
            try {
              await togglePageCommentReaction({
                commentId: comment.id,
                emoji,
                add,
              });
            } catch (err) {
              console.error("[page-comment] reaction toggle failed", err);
              onLocalReact(comment.id, emoji, !add); // rollback
            }
          }}
        />
      </div>
    </div>
  );
}

function ReactPopover({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Добавить реакцию"
          data-tip="Добавить реакцию"
          className="inline-flex items-center justify-center size-6 rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <SmilePlus className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={6}
        className="w-auto p-1 rounded-lg"
      >
        <div className="flex items-center gap-0.5">
          {QUICK_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onPick(e);
                setOpen(false);
              }}
              className="text-lg p-1 rounded hover:bg-accent transition-colors"
              aria-label={`Реакция ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ReactionRow({
  reactions,
  currentUserId,
  canReact,
  onToggle,
}: {
  reactions: Record<string, string[]>;
  currentUserId: string;
  canReact: boolean;
  onToggle: (emoji: string, add: boolean) => void;
}) {
  const entries = Object.entries(reactions).filter(
    ([, ids]) => ids.length > 0,
  );
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 mt-1.5">
      {entries.map(([emoji, userIds]) => {
        const isMine = userIds.includes(currentUserId);
        return (
          <button
            key={emoji}
            type="button"
            disabled={!canReact}
            onClick={() => onToggle(emoji, !isMine)}
            className={cn(
              "inline-flex items-center gap-1 h-6 px-1.5 rounded-md border text-[12px] transition-colors",
              isMine
                ? "bg-brand/10 border-brand/40 text-brand hover:bg-brand/15"
                : "bg-muted/50 border-border hover:bg-accent",
              !canReact && "cursor-not-allowed opacity-60",
            )}
          >
            <span className="text-sm leading-none">{emoji}</span>
            <span className="font-medium tabular-nums">{userIds.length}</span>
          </button>
        );
      })}
    </div>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Краткое относительное время: «5m», «3h», «вчера», «12 янв». */
function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return "только что";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} мин назад`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} ч назад`;
  if (diffSec < 86400 * 2) return "вчера";
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} дн назад`;
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}
