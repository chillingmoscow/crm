/**
 * Модель комментария к странице базы знаний — общая для браузера
 * (page-comments.ts) и сервера (page-comments-initial.ts, первая отрисовка
 * обсуждения вместе со страницей).
 */
import type { Database } from "@/types/database";

export type PageCommentRpcRow =
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

export function rowToComment(row: PageCommentRpcRow): PageComment {
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

