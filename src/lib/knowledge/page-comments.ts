"use client";

/**
 * Data layer для page-level комментариев KB-страницы.
 *
 * В отличие от inline-комментариев (kb_threads.kind='inline', управляются
 * BlockNote ThreadStore через kb-floating-composer / kb-floating-thread),
 * page-level threads (kind='page') — top-level discussion, не привязаны
 * к выделению текста. Хранятся в тех же таблицах, отличаются только
 * kind-колонкой (миграция 114).
 *
 * UX-модель MVP: один top-level комментарий = один thread (kind='page'),
 * без nested replies. Если потом понадобится Notion-style threading,
 * расширим: добавим parent_comment_id или просто ставим несколько
 * comments в один thread и рендерим иерархически.
 *
 * RLS уже настроен в миграции 076 — kind-agnostic. Для read нужен
 * `kb.view_pages`, для write — `kb.comment_pages`. Edit/delete —
 * только автор (kb_comments_update_own).
 */

import { createClient } from "@/lib/supabase/client";
import { extractMentionedUserIds } from "@/lib/knowledge/mention-extract";
import type { KbBlock } from "@/types/knowledge";
import type { Database } from "@/types/database";

type KbCommentRow = Database["public"]["Tables"]["kb_comments"]["Row"];
type KbThreadRow = Database["public"]["Tables"]["kb_threads"]["Row"];

export interface PageComment {
  id: string;
  threadId: string;
  body: unknown[]; // BlockNote CommentBody = массив блоков
  authorId: string;
  /** {emoji: userId[]} — формат kb_comments.reactions jsonb. */
  reactions: Record<string, string[]>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

function rowToComment(row: KbCommentRow & { thread_id: string }): PageComment {
  return {
    id: row.id,
    threadId: row.thread_id,
    body: Array.isArray(row.body) ? (row.body as unknown[]) : [],
    authorId: row.author_id,
    reactions: parseReactions(row.reactions),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
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

/** Загрузить все page-level threads + comments одной страницы.
 *
 *  Two-query path: сначала находим page-threads, потом тянем их comments.
 *  Альтернативный inner-join `kb_threads!inner(...)` тоже работает, но
 *  возвращает данные nested и хуже типизируется до regenerate'а
 *  database.ts (kind ещё не в схеме). RLS на обеих таблицах добавляет
 *  account_id + kb.view_pages фильтр.
 *
 *  Возвращает comments отсортированные по created_at asc. Soft-deleted
 *  threads пропускаются полностью; comments внутри живых threads
 *  возвращаются включая soft-deleted (UI рендерит tombstone).
 */
export async function fetchPageComments(pageId: string): Promise<PageComment[]> {
  const supabase = createClient();
  // 1. Page-level threads. `kind='page'` фильтр; `kind` ещё не в типе,
  //    поэтому cast.
  const { data: threadRows, error: threadErr } = await supabase
    .from("kb_threads")
    .select("id")
    .eq("page_id", pageId)
    .eq("kind" as never, "page" as never)
    .is("deleted_at", null);
  if (threadErr) {
    console.error("[page-comments] fetch threads failed", threadErr);
    throw new Error(`Не удалось загрузить комментарии: ${threadErr.message}`);
  }
  const threadIds = (threadRows ?? []).map((r) => r.id);
  if (threadIds.length === 0) return [];
  // 2. Comments в этих thread'ах. Включая soft-deleted (tombstone в UI).
  const { data: commentRows, error: commentErr } = await supabase
    .from("kb_comments")
    .select("id, thread_id, body, author_id, reactions, created_at, updated_at, deleted_at")
    .in("thread_id", threadIds)
    .order("created_at", { ascending: true });
  if (commentErr) {
    console.error("[page-comments] fetch comments failed", commentErr);
    throw new Error(`Не удалось загрузить комментарии: ${commentErr.message}`);
  }
  return (commentRows ?? []).map((row) =>
    rowToComment(row as KbCommentRow & { thread_id: string }),
  );
}

/** Создать новый top-level page-comment (один thread с одним comment'ом).
 *  Вызывает kb_emit_comment_mentions в фоне для @-уведомлений. */
export async function createPageComment(args: {
  pageId: string;
  accountId: string;
  body: unknown[];
}): Promise<PageComment> {
  const supabase = createClient();
  // 1. Создать thread с kind='page'.
  // Cast необходим — kind ещё не в auto-generated Insert-типе.
  const { data: threadRow, error: threadErr } = await supabase
    .from("kb_threads")
    .insert({
      page_id: args.pageId,
      account_id: args.accountId,
      kind: "page",
    } as never)
    .select("id, page_id, account_id, created_at, updated_at, deleted_at, created_by, resolved, resolved_at, resolved_by, metadata")
    .single<KbThreadRow>();
  if (threadErr || !threadRow) {
    throw new Error(`Не удалось создать thread: ${threadErr?.message ?? "no row"}`);
  }
  // 2. Создать comment. page_id auto-fill'ится trigger'ом
  //    `kb_comments_set_page_id` (миграция 106) — передавать его не надо.
  const { data: commentRow, error: commentErr } = await supabase
    .from("kb_comments")
    .insert({
      thread_id: threadRow.id,
      account_id: args.accountId,
      body: args.body as never,
      author_id: (await supabase.auth.getUser()).data.user?.id ?? "",
    })
    .select("id, thread_id, body, author_id, reactions, created_at, updated_at, deleted_at")
    .single<KbCommentRow & { thread_id: string }>();
  if (commentErr || !commentRow) {
    // Best-effort cleanup: thread без comment'а — мусор, soft-delete его.
    await supabase
      .from("kb_threads")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", threadRow.id);
    throw new Error(`Не удалось создать комментарий: ${commentErr?.message ?? "no row"}`);
  }
  // 3. Fire-and-forget mention notifications.
  emitMentions(commentRow.id, args.body);
  return rowToComment(commentRow);
}

export async function updatePageComment(args: {
  commentId: string;
  body: unknown[];
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("kb_comments")
    .update({
      body: args.body as never,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.commentId);
  if (error) {
    throw new Error(`Не удалось обновить комментарий: ${error.message}`);
  }
  // Re-emit mentions: если в edit'е появились новые @-упоминания,
  // notif улетит. PK kb_comment_user_mentions защищает старых от дублей.
  emitMentions(args.commentId, args.body);
}

/** Soft-delete коммент. Если в его thread'е больше нет live-comments
 *  — soft-delete и thread (zero-comment thread'ы — мусор, не должны
 *  отображаться даже как пустые tombstone-секции). */
export async function deletePageComment(args: {
  commentId: string;
  threadId: string;
}): Promise<void> {
  const supabase = createClient();
  const now = new Date().toISOString();
  const { error: cErr } = await supabase
    .from("kb_comments")
    .update({ deleted_at: now })
    .eq("id", args.commentId);
  if (cErr) {
    throw new Error(`Не удалось удалить комментарий: ${cErr.message}`);
  }
  // Проверяем остались ли live-comments в этом thread'е.
  const { count, error: countErr } = await supabase
    .from("kb_comments")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", args.threadId)
    .is("deleted_at", null);
  if (countErr) {
    // Не критично — comment удалён, thread остаётся как есть.
    console.warn("[page-comments] could not count live comments after delete", countErr);
    return;
  }
  if ((count ?? 0) === 0) {
    await supabase
      .from("kb_threads")
      .update({ deleted_at: now })
      .eq("id", args.threadId);
  }
}

/** Toggle reaction на комменте. Идемпотентно через RPC
 *  (kb_comment_react / kb_comment_unreact, миграция 076). */
export async function togglePageCommentReaction(args: {
  commentId: string;
  emoji: string;
  /** true → react, false → unreact. Caller проверяет current state. */
  add: boolean;
}): Promise<void> {
  const supabase = createClient();
  const { error } = args.add
    ? await supabase.rpc("kb_comment_react", {
        p_comment_id: args.commentId,
        p_emoji: args.emoji,
      })
    : await supabase.rpc("kb_comment_unreact", {
        p_comment_id: args.commentId,
        p_emoji: args.emoji,
      });
  if (error) {
    throw new Error(`Не удалось обновить реакцию: ${error.message}`);
  }
}

function emitMentions(commentId: string, body: unknown[]): void {
  const supabase = createClient();
  const blocks = (Array.isArray(body) ? body : []) as KbBlock[];
  const userIds = extractMentionedUserIds(blocks);
  if (userIds.length === 0) return;
  void supabase
    .rpc("kb_emit_comment_mentions", {
      p_comment_id: commentId,
      p_user_ids: userIds,
    })
    .then(({ error }) => {
      if (error) {
        console.warn("[page-comments] emit mentions failed", {
          commentId,
          error: error.message,
        });
      }
    });
}
