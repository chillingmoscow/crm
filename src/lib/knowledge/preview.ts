"use server";

import { createClient } from "@/lib/supabase/server";
import { estimateReadingMinutes } from "@/lib/knowledge/reading-time";

export interface KbPagePreview {
  slug: string;
  title: string;
  icon: string | null;
  icon_color: string | null;
  /** Первые ~180 символов plain_text — достаточно для tooltip-snippet'а
   *  но не нагружает payload. */
  snippet: string;
  /** Минут чтения (через estimateReadingMinutes). 0/null если страница
   *  пустая. */
  reading_minutes: number | null;
  required_reading: boolean;
  is_locked: boolean;
}

const SNIPPET_LENGTH = 180;

/** Preview KB-страницы для inline-link tooltip'а. RLS на kb_pages
 *  фильтрует по active account и kb.view_pages — если caller не
 *  имеет доступа, .maybeSingle() вернёт null.
 *
 *  Sprint D Phase 7 / plan §2.X (inline-preview tooltip). Вызывается
 *  из client'а KbLinkPreview на hover @-mention'ом. Кэшируется на
 *  client-side per-slug. */
export async function getKbPagePreview(
  slug: string,
): Promise<{ preview: KbPagePreview | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_pages")
    .select(
      "slug, title, icon, icon_color, plain_text, required_reading, locked_at",
    )
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return { preview: null, error: error.message };
  if (!data) return { preview: null, error: null };

  const plain = data.plain_text ?? "";
  const trimmed = plain.trim();
  const snippet =
    trimmed.length > SNIPPET_LENGTH
      ? trimmed.slice(0, SNIPPET_LENGTH).trimEnd() + "…"
      : trimmed;
  const readingMinutes = trimmed.length > 0 ? estimateReadingMinutes(plain) : null;

  return {
    preview: {
      slug: data.slug,
      title: data.title,
      icon: data.icon,
      icon_color: data.icon_color,
      snippet,
      reading_minutes: readingMinutes,
      required_reading: data.required_reading,
      is_locked: data.locked_at !== null,
    },
    error: null,
  };
}

export interface KbStaffPreview {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  /** Название должности (kb-роли) в active venue. null если у юзера
   *  нет active-membership в каком-либо venue текущего аккаунта. */
  role_name: string | null;
}

/** Preview сотрудника для inline-mention tooltip'а (`/people/staff/<id>`).
 *
 *  Использует тот же account-scoped path что и mention-picker
 *  (`kb_list_account_members` RPC) — иначе в multi-venue аккаунтах
 *  mention резолвится в picker'е, но preview возвращает null для
 *  сотрудников ВНЕ active venue'а (RLS на profiles venue-scoped).
 *  См. Codex #85 P2.
 *
 *  Sprint D Phase 7 / inline-preview tooltip — staff-вариант.
 *  Кэшируется на client-side per-userId (как и page-preview). */
export async function getKbStaffPreview(
  userId: string,
): Promise<{ preview: KbStaffPreview | null; error: string | null }> {
  const supabase = await createClient();
  // kb_list_account_members account-scoped через RPC's body — RLS на
  // profiles не мешает. Без query / с пустым — отдаст всех members
  // до лимита; ищем нужного userId среди них. На реальных аккаунтах
  // (десятки members) лимит 200 покрывает с запасом; client-side
  // cache в KbLinkPreview предотвращает повторные запросы.
  const { data: members, error: rpcErr } = await supabase.rpc(
    "kb_list_account_members",
    { p_query: "", p_limit: 200 },
  );
  if (rpcErr) return { preview: null, error: rpcErr.message };

  const member = (members ?? []).find((m) => m.id === userId);
  if (!member) return { preview: null, error: null };

  const fullName =
    [member.first_name, member.last_name].filter(Boolean).join(" ") ||
    "Без имени";

  // Active role в active venue caller'а. user_venue_roles RLS пускает
  // active members своих venue'ов; если упомянутый юзер не в active
  // venue caller'а — role_name просто null (chip рендерится без role'а).
  const { data: roleRow } = await supabase
    .from("user_venue_roles")
    .select("roles(name)")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  const roleName = (roleRow as { roles?: { name?: string } } | null)?.roles?.name ?? null;

  return {
    preview: {
      user_id: member.id,
      full_name: fullName,
      avatar_url: member.avatar_url,
      role_name: roleName,
    },
    error: null,
  };
}
