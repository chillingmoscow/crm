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
import type { Database, Json } from "@/types/database";

type PageCommentRpcRow =
  Database["public"]["Functions"]["kb_list_page_comments"]["Returns"][number];

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

function rowToComment(row: PageCommentRpcRow): PageComment {
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

/** Загрузить все page-level comments одной страницы одним RPC. */
export async function fetchPageComments(pageId: string): Promise<PageComment[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("kb_list_page_comments", {
    p_page_id: pageId,
  });
  if (error) {
    console.error("[page-comments] fetch page comments failed", error);
    throw new Error(`Не удалось загрузить комментарии: ${error.message}`);
  }
  return (data ?? []).map(rowToComment);
}

/** Создать новый top-level page-comment (один thread с одним comment'ом).
 *  Вызывает kb_emit_comment_mentions в фоне для @-уведомлений. */
export async function createPageComment(args: {
  pageId: string;
  body: unknown[];
}): Promise<PageComment> {
  const supabase = createClient();
  const { data, error } = await supabase
    .rpc("kb_create_page_comment", {
      p_page_id: args.pageId,
      p_body: args.body as Json,
    })
    .single();
  if (error || !data) {
    throw new Error(`Не удалось создать комментарий: ${error?.message ?? "no row"}`);
  }
  const commentRow = data as PageCommentRpcRow;
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
