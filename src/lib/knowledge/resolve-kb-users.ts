"use client";

import type { User } from "@blocknote/core/comments";

import { createClient } from "@/lib/supabase/client";

/** Resolve user info для CommentsExtension `resolveUsers` callback.
 *  BlockNote передаёт массив userIds — возвращаем User[] с avatar.
 *
 *  Использует account-scoped RPC `kb_resolve_users_by_ids` (миграция
 *  101) — точечный fetch по запрошенному списку без 25-лимита из
 *  `kb_list_account_members`. Codex #92 P1 fix: для аккаунтов с >25
 *  members часть юзеров silently не возвращалась и попадала под
 *  placeholder «Удалённый пользователь».
 *
 *  Placeholder остаётся для missing IDs: BN ожидает entry для
 *  КАЖДОГО userId в request'е (internal useUsers Map-lookup). Если
 *  юзер удалён / off-boarded / выбыл из аккаунта — placeholder
 *  гарантирует, что BN не падает. */
export async function resolveKbUsers(userIds: string[]): Promise<User[]> {
  if (userIds.length === 0) return [];
  const supabase = createClient();
  const { data } = await supabase.rpc("kb_resolve_users_by_ids", {
    p_user_ids: userIds,
  });
  const found = new Map<string, User>();
  for (const m of data ?? []) {
    const fullName =
      [m.first_name, m.last_name].filter(Boolean).join(" ").trim() ||
      "Без имени";
    found.set(m.id, {
      id: m.id,
      username: fullName,
      avatarUrl: m.avatar_url ?? "",
    });
  }
  return userIds.map(
    (id): User =>
      found.get(id) ?? {
        id,
        username: "Удалённый пользователь",
        avatarUrl: "",
      },
  );
}
