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
 *  RLS на user_venue_roles + profiles фильтрует по active-account
 *  (kb-mention picker уже использует тот же pool через
 *  kb_list_account_members). Фетчим profile + active membership
 *  одним подзапросом.
 *
 *  Sprint D Phase 7 / inline-preview tooltip — staff-вариант.
 *  Кэшируется на client-side per-userId (как и page-preview). */
export async function getKbStaffPreview(
  userId: string,
): Promise<{ preview: KbStaffPreview | null; error: string | null }> {
  const supabase = await createClient();
  // profile + первое active-membership с role-name. Фильтруем по
  // current account через user_venue_roles + venues — если у юзера
  // нет ролей в текущем аккаунте, role_name возвращается null
  // (не падаем — chip всё равно рендерится с именем).
  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (profErr) return { preview: null, error: profErr.message };
  if (!profile) return { preview: null, error: null };

  const fullName =
    [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
    "Без имени";

  // Active role в текущем аккаунте — берём первую попавшуюся (юзер
  // может быть в нескольких venue'ах с разными ролями, но для
  // tooltip'а одной достаточно).
  const { data: roleRow } = await supabase
    .from("user_venue_roles")
    .select("roles(name), venues!inner(account_id)")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  const roleName = (roleRow as { roles?: { name?: string } } | null)?.roles?.name ?? null;

  return {
    preview: {
      user_id: profile.id,
      full_name: fullName,
      avatar_url: profile.avatar_url,
      role_name: roleName,
    },
    error: null,
  };
}
