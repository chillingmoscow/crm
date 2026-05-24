"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Inline-action в notif'е (Notion-style). emit'ер кладёт actions[] в
 * payload, bell рендерит как кнопки, click диспатчит через action-
 * registry на client'е.
 *
 * Schema: { label, action_type, target_id?, payload? }. action_type —
 * dispatch-key для registry. target_id — entity на которую action
 * направлен (например, transaction_id для approve). payload — free-form
 * для action-specific data.
 */
export interface KbNotificationAction {
  label: string;
  action_type: string;
  target_id?: string;
  payload?: Record<string, unknown>;
}

export type NotificationPayload = {
  /** Сниппет содержания (≤180 chars) для preview-card. Может быть
   *  заголовком страницы, текстом коммента, суммой транзакции — что
   *  именно зависит от emit'ера. */
  preview?: string;
  /** Discriminator для preview-render'а в bell'е. */
  preview_kind?: string;
  /** Inline-actions массив. Если пусто — bell рендерит дефолтную
   *  кнопку «Открыть» (если есть link). */
  actions?: KbNotificationAction[];
  // Free-form additional fields per emitter.
  [key: string]: unknown;
};

export type Notification = {
  id:           string;
  type:         string;
  category:     string;
  title:        string;
  body:         string | null;
  link:         string | null;
  read:         boolean;
  archived_at:  string | null;
  actor_user_id: string | null;
  entity_type:  string | null;
  entity_id:    string | null;
  payload:      NotificationPayload;
  created_at:   string;
};

interface GetNotificationsArgs {
  /** Скоуп: 'active' = archived_at IS NULL (default), 'archived' = NOT NULL. */
  scope?: "active" | "archived";
  /** Cursor по created_at для load-more (исключает rows >= before). */
  before?: string;
  /** Page size. Default 50. */
  limit?: number;
}

export async function getNotifications(
  args: GetNotificationsArgs = {},
): Promise<Notification[]> {
  const { scope = "active", before, limit = 50 } = args;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  let query = supabase
    .from("notifications")
    .select(
      "id, type, category, title, body, link, read, archived_at, actor_user_id, entity_type, entity_id, payload, created_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (scope === "active") {
    query = query.is("archived_at", null);
  } else {
    query = query.not("archived_at", "is", null);
  }

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data } = await query;
  // Cast — DB returns category/payload as non-strict types (default = '{}'::jsonb).
  return (data ?? []) as unknown as Notification[];
}

export async function markNotificationRead(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("id", id);
  if (error) console.error("[notifications] markNotificationRead failed:", error.message);
}

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", user.id)
    .eq("read", false);
  if (error) console.error("[notifications] markAllNotificationsRead failed:", error.message);
}

/** Архивирует одиночное уведомление. RLS пускает UPDATE только на
 *  свои rows (user_id = auth.uid()). */
export async function archiveNotification(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error("[notifications] archiveNotification failed:", error.message);
}

/** Восстанавливает из архива (юзер может ошибочно архивировать). */
export async function unarchiveNotification(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ archived_at: null })
    .eq("id", id);
  if (error) console.error("[notifications] unarchiveNotification failed:", error.message);
}

/** Bulk-архивация всех прочитанных active rows юзера. Используется
 *  кнопкой «Архивировать прочитанные» в footer'е bell'а. */
export async function archiveAllRead(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from("notifications")
    .update({ archived_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("read", true)
    .is("archived_at", null);
  if (error) console.error("[notifications] archiveAllRead failed:", error.message);
}

export interface NotificationActor {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

/** Batch-fetch профилей actor'ов для bell-render'а. Принимает
 *  список user_id'ов из `notifications.actor_user_id` → возвращает
 *  массив { id, full_name, avatar_url }.
 *
 *  Использует RPC `kb_resolve_users_by_ids` (миграция 101) — точечный
 *  account-scoped fetch без 25-лимита из `kb_list_account_members`.
 *  Без этого в аккаунтах с >25 active members часть actor'ов
 *  silently не возвращалась → bell рендерил «без actor'а». */
export async function getNotificationActors(
  userIds: string[],
): Promise<NotificationActor[]> {
  if (userIds.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kb_resolve_users_by_ids", {
    p_user_ids: userIds,
  });
  if (error) {
    console.error("[notifications] getNotificationActors RPC failed:", error.message);
    return [];
  }
  return (data ?? []).map((m) => {
    const parts = [m.first_name, m.last_name].filter(Boolean) as string[];
    return {
      id: m.id,
      full_name: parts.length > 0 ? parts.join(" ") : "Без имени",
      avatar_url: m.avatar_url,
    };
  });
}
