import "server-only";

import { createClient } from "@/lib/supabase/server";
import { rowToComment, type PageComment } from "@/lib/knowledge/page-comments-model";

export interface KbPageCommentAuthor {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface KbPageCommentsInitial {
  comments: PageComment[];
  users: KbPageCommentAuthor[];
}

/**
 * Обсуждение страницы для первой отрисовки: комментарии и их авторы
 * приходят с сервера вместе со страницей. Раньше браузер запрашивал их
 * уже после показа, и обсуждение над текстом появлялось позже — текст
 * дёргался вниз (замечание владельца 28.11.2026).
 *
 * Ошибка не ломает страницу: `null` — браузер загрузит обсуждение сам,
 * как раньше.
 */
export async function loadKbPageCommentsInitial(
  pageId: string,
): Promise<KbPageCommentsInitial | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kb_list_page_comments", {
    p_page_id: pageId,
  });
  if (error) {
    console.error("[page-comments] initial server load failed", error);
    return null;
  }
  const comments = (data ?? []).map(rowToComment);
  const authorIds = Array.from(new Set(comments.map((c) => c.authorId).filter(Boolean)));
  if (authorIds.length === 0) return { comments, users: [] };
  const { data: people } = await supabase.rpc("kb_resolve_users_by_ids", {
    p_user_ids: authorIds,
  });
  const found = new Map(
    (people ?? []).map((m) => [
      m.id,
      {
        id: m.id,
        fullName: [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || "Без имени",
        avatarUrl: m.avatar_url ?? null,
      },
    ]),
  );
  // Как resolveKbUsers в браузере: у выбывшего автора — заглушка.
  const users = authorIds.map(
    (id) => found.get(id) ?? { id, fullName: "Удалённый пользователь", avatarUrl: null },
  );
  return { comments, users };
}
