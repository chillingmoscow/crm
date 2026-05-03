"use server";

import { createClient } from "@/lib/supabase/server";

// ============================================================
// Sprint D / Phase 6 — Server-actions для landing-виджетов.
// ============================================================

export interface KbLandingPageRow {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  icon_color: string | null;
}

export interface KbRequiredUnreadRow extends KbLandingPageRow {
  /** Когда страница помечена как обязательная (сортировка по этому
   *  полю — сначала свежие). */
  required_since: string;
}

export interface KbRecentlyViewedRow extends KbLandingPageRow {
  /** ISO timestamp последнего визита. Используется для сортировки и
   *  опционально для «5 мин назад» подписи. */
  last_visit_at: string;
}

/** Список страниц с required_reading=true, которые current user ещё
 *  НЕ подтвердил прочтение. Сортировка: сначала свежие (по updated_at
 *  страницы — proxy для «когда стало обязательным»).
 *
 *  RLS на kb_pages фильтрует чтение по `kb.view_pages`. Если у юзера
 *  нет права — возвращаем []. Если у юзера нет required_unread —
 *  возвращаем [], landing просто скрывает секцию.
 *
 *  Sprint D Phase 6 §2.6. */
export async function getKbRequiredUnreadForUser(): Promise<{
  rows: KbRequiredUnreadRow[];
  error: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { rows: [], error: null };

  // Шаг 1: required-pages в active account.
  const { data: pages, error: pagesError } = await supabase
    .from("kb_pages")
    .select("id, slug, title, icon, icon_color, updated_at")
    .eq("required_reading", true)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false, nullsFirst: false });
  if (pagesError) return { rows: [], error: pagesError.message };
  if (!pages || pages.length === 0) return { rows: [], error: null };

  // Шаг 2: мои read-records для этих страниц. Subselect через
  // kb_page_reads с `.in("page_id", ids)` дешевле чем left-join
  // — strait-forward Postgres.
  const pageIds = pages.map((p) => p.id);
  const { data: reads, error: readsError } = await supabase
    .from("kb_page_reads")
    .select("page_id")
    .eq("user_id", user.id)
    .in("page_id", pageIds);
  if (readsError) return { rows: [], error: readsError.message };

  const readSet = new Set((reads ?? []).map((r) => r.page_id));
  const rows: KbRequiredUnreadRow[] = pages
    .filter((p) => !readSet.has(p.id))
    .map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      icon: p.icon,
      icon_color: p.icon_color,
      required_since: (p.updated_at as string | null) ?? new Date().toISOString(),
    }));
  return { rows, error: null };
}

/** Recently-viewed pages для current user. Backed by RPC
 *  `kb_get_my_recently_viewed` (миграция 085) — security-definer,
 *  возвращает только page-meta + last-visit timestamp.
 *
 *  Это навигационный helper, не аналитика — admin-only-stats decision
 *  из Sprint D §4 не нарушается (нет time/sessions-данных).
 *
 *  Sprint D Phase 6 §2.6. */
export async function getMyRecentlyViewedKbPages(
  limit = 7,
): Promise<{ rows: KbRecentlyViewedRow[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kb_get_my_recently_viewed", {
    p_limit: limit,
  });
  if (error) return { rows: [], error: error.message };
  const rows: KbRecentlyViewedRow[] = (data ?? []).map((r) => ({
    id: r.page_id,
    slug: r.slug,
    title: r.title,
    icon: r.icon,
    icon_color: r.icon_color,
    last_visit_at: r.last_visit_at,
  }));
  return { rows, error: null };
}
