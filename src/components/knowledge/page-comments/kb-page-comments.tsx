"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import {
  fetchPageComments,
  createPageComment,
  type PageComment,
} from "@/lib/knowledge/page-comments";
import { resolveKbUsers } from "@/lib/knowledge/comments-store";
import { PageCommentComposer } from "./page-comment-composer";
import { PageCommentItem } from "./page-comment-item";

interface KbPageCommentsProps {
  pageId: string;
  accountId: string;
  userId: string;
  currentUserName: string | null;
  currentUserAvatarUrl: string | null;
  /** kb.comment_pages — необходимо для написания / редактирования /
   *  реакций. Юзеры без этого permission'а видят только существующие
   *  комментарии (read-only). */
  canComment: boolean;
  /** kb.edit_any_page — admin-операции (delete чужих). Reserved.  */
  canEdit: boolean;
}

/** Минимальные user-данные для рендера автора. Получаем через
 *  resolveKbUsers (RPC kb_resolve_users_by_ids), кэшируем по userId. */
interface ResolvedUser {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

/**
 * Page-level Comments — Notion-style top-level discussion thread.
 *
 * Рендерится в `kb-page-editor.tsx` между `<KbPageProperties>` и
 * BlockNote editor'ом. Не зависит от ThreadStore — читает / пишет
 * напрямую в kb_threads (kind='page') + kb_comments через
 * `src/lib/knowledge/page-comments.ts`.
 *
 * Render-gate: если у юзера НЕТ kb.comment_pages И комментариев пока
 * нет — компонент не рендерится (нет шумного пустого блока). Если
 * комментарии есть — рендерим в read-only.
 *
 * Realtime: подписка на kb_comments INSERT/UPDATE по page_id. Self-
 * broadcast suppression через Set<commentId> локально-вставленных id.
 * Lazy thread-kind cache, чтобы инлайн-comment'ы (kind='inline') не
 * прорывались в UI.
 */
export function KbPageComments({
  pageId,
  accountId,
  userId,
  currentUserName,
  currentUserAvatarUrl,
  canComment,
  canEdit,
}: KbPageCommentsProps) {
  const [comments, setComments] = useState<PageComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<Map<string, ResolvedUser>>(new Map());

  // ID'шники thread'ов, известных как kind='page'. Realtime присылает
  // kb_comments-row без kind — этот cache позволяет фильтровать инлайн-
  // комменты на лету.
  const pageThreadIds = useRef<Set<string>>(new Set());
  // ID'шники thread'ов, которые мы УЖЕ запросили из БД (чтобы не
  // дёргать select kind=… повторно для одного и того же thread'а).
  const checkedThreadIds = useRef<Set<string>>(new Set());
  // Comment IDs, которые сами что-то с ними сделали (insert / update /
  // delete) — игнорим self-broadcast.
  const localCommentIds = useRef<Set<string>>(new Set());

  // Resolve авторов для всех уникальных author_id в comments. Кэшируем,
  // чтобы каждый realtime-update не триггерил повторный fetch.
  const resolveMissingUsers = useCallback(
    async (rows: PageComment[]) => {
      const missing = Array.from(
        new Set(
          rows.map((r) => r.authorId).filter((id) => !users.has(id) && id),
        ),
      );
      if (missing.length === 0) return;
      const resolved = await resolveKbUsers(missing);
      setUsers((prev) => {
        const next = new Map(prev);
        for (const u of resolved) {
          next.set(u.id, {
            id: u.id,
            fullName: u.username,
            avatarUrl: u.avatarUrl || null,
          });
        }
        return next;
      });
    },
    [users],
  );

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPageComments(pageId)
      .then((rows) => {
        if (cancelled) return;
        for (const r of rows) {
          pageThreadIds.current.add(r.threadId);
          checkedThreadIds.current.add(r.threadId);
        }
        setComments(rows);
        void resolveMissingUsers(rows);
      })
      .catch((err) => console.error("[page-comments] initial load failed", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pageId, resolveMissingUsers]);

  // Realtime subscription. Filter по page_id — RLS на kb_comments
  // дополнительно фильтрует по account / view_pages.
  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = supabase
      .channel(`kb-page-comments-${pageId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "kb_comments",
          filter: `page_id=eq.${pageId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as
            | { id?: string; thread_id?: string }
            | undefined;
          if (!row?.id || !row.thread_id) return;
          if (localCommentIds.current.has(row.id)) {
            // Self-broadcast — UI уже актуален.
            return;
          }
          // Lazy thread-kind проверка. Если thread не в page-set'е и
          // не проверен — спрашиваем БД один раз. inline-thread'ы
          // не попадают в UI.
          if (!pageThreadIds.current.has(row.thread_id)) {
            if (checkedThreadIds.current.has(row.thread_id)) return;
            checkedThreadIds.current.add(row.thread_id);
            void supabase
              .from("kb_threads")
              .select("id, kind")
              .eq("id", row.thread_id)
              .maybeSingle<{ id: string; kind: string }>()
              .then(({ data }) => {
                if (!data || data.kind !== "page") return;
                pageThreadIds.current.add(data.id);
                applyChange(payload);
              });
            return;
          }
          applyChange(payload);
        },
      )
      .subscribe();

    function applyChange(payload: {
      eventType: string;
      new: Record<string, unknown> | null;
      old: Record<string, unknown> | null;
    }) {
      if (payload.eventType === "INSERT" && payload.new) {
        const row = payloadToComment(payload.new);
        if (!row) return;
        setComments((prev) => {
          if (prev.some((c) => c.id === row.id)) return prev;
          // Insert in created_at-ordered position.
          const next = [...prev, row].sort((a, b) =>
            a.createdAt.localeCompare(b.createdAt),
          );
          return next;
        });
        void resolveMissingUsers([row]);
      } else if (payload.eventType === "UPDATE" && payload.new) {
        const row = payloadToComment(payload.new);
        if (!row) return;
        setComments((prev) =>
          prev.map((c) => (c.id === row.id ? row : c)),
        );
      } else if (payload.eventType === "DELETE" && payload.old) {
        const id = payload.old.id as string | undefined;
        if (!id) return;
        // Postgres DELETE event — у нас soft-delete, так что обычно
        // приходит UPDATE. На всякий случай поддерживаем hard-delete тоже.
        setComments((prev) => prev.filter((c) => c.id !== id));
      }
    }

    return () => {
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    };
  }, [pageId, resolveMissingUsers]);

  // Optimistic insert на submit composer'а.
  const handleSubmitNew = useCallback(
    async (body: unknown[]) => {
      const inserted = await createPageComment({
        pageId,
        accountId,
        body,
      });
      pageThreadIds.current.add(inserted.threadId);
      checkedThreadIds.current.add(inserted.threadId);
      localCommentIds.current.add(inserted.id);
      setComments((prev) => {
        if (prev.some((c) => c.id === inserted.id)) return prev;
        return [...prev, inserted].sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt),
        );
      });
      void resolveMissingUsers([inserted]);
    },
    [pageId, accountId, resolveMissingUsers],
  );

  // Local-state mutations (вызываются из PageCommentItem на оптимистических
  // путях). Realtime echo'и потом совпадут — `localCommentIds` не нужен
  // тут, потому что update/delete события всё равно валидны (UI уже
  // в правильном state'е, перерендер — no-op).
  const handleLocalUpdate = useCallback(
    (commentId: string, body: unknown[]) => {
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { ...c, body, updatedAt: new Date().toISOString() }
            : c,
        ),
      );
    },
    [],
  );
  const handleLocalDelete = useCallback((commentId: string) => {
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId
          ? { ...c, deletedAt: new Date().toISOString() }
          : c,
      ),
    );
  }, []);
  const handleLocalReact = useCallback(
    (commentId: string, emoji: string, add: boolean) => {
      setComments((prev) =>
        prev.map((c) => {
          if (c.id !== commentId) return c;
          const current = c.reactions[emoji] ?? [];
          const has = current.includes(userId);
          let nextIds: string[];
          if (add && !has) nextIds = [...current, userId];
          else if (!add && has) nextIds = current.filter((u) => u !== userId);
          else return c;
          const nextReactions = { ...c.reactions };
          if (nextIds.length === 0) {
            delete nextReactions[emoji];
          } else {
            nextReactions[emoji] = nextIds;
          }
          return { ...c, reactions: nextReactions };
        }),
      );
    },
    [userId],
  );

  // Render gate: если нет permission'а и нет live-комментариев — не
  // рендерим вообще (эмпти-state без composer'а — шум).
  const visibleComments = comments.filter((c) => !c.deletedAt);
  if (!canComment && visibleComments.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3 py-2">
      {!loading && comments.length > 0 && (
        <div className="flex flex-col gap-3">
          {comments.map((c) => (
            <PageCommentItem
              key={c.id}
              comment={c}
              author={users.get(c.authorId) ?? null}
              currentUserId={userId}
              canComment={canComment}
              canEdit={canEdit}
              currentUserName={currentUserName}
              currentUserAvatarUrl={currentUserAvatarUrl}
              onLocalUpdate={handleLocalUpdate}
              onLocalDelete={handleLocalDelete}
              onLocalReact={handleLocalReact}
            />
          ))}
        </div>
      )}
      {canComment && (
        <PageCommentComposer
          currentUserName={currentUserName}
          currentUserAvatarUrl={currentUserAvatarUrl}
          onSubmit={handleSubmitNew}
        />
      )}
    </section>
  );
}

/** Конверсия postgres_changes payload в PageComment. */
function payloadToComment(row: Record<string, unknown>): PageComment | null {
  if (typeof row.id !== "string" || typeof row.thread_id !== "string") {
    return null;
  }
  return {
    id: row.id,
    threadId: row.thread_id,
    body: Array.isArray(row.body) ? (row.body as unknown[]) : [],
    authorId: typeof row.author_id === "string" ? row.author_id : "",
    reactions: parseReactions(row.reactions),
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : new Date().toISOString(),
    updatedAt:
      typeof row.updated_at === "string"
        ? row.updated_at
        : new Date().toISOString(),
    deletedAt: typeof row.deleted_at === "string" ? row.deleted_at : null,
  };
}

function parseReactions(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [emoji, userIds] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(userIds)) {
      out[emoji] = userIds.filter((u): u is string => typeof u === "string");
    }
  }
  return out;
}
