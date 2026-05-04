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

  // Шаг 2: версионная сверка. После миграции 097 user считается
  // «прочитавшим» только если его max(read_version) >= max(version_number)
  // страницы. Иначе (= никогда не читал ИЛИ читал устаревшую версию)
  // → попадает в unread list. См. Codex #88 P1.
  const pageIds = pages.map((p) => p.id);
  const [versionsRes, readsRes] = await Promise.all([
    supabase
      .from("kb_page_versions")
      .select("page_id, version_number")
      .in("page_id", pageIds),
    supabase
      .from("kb_page_reads")
      .select("page_id, read_version")
      .eq("user_id", user.id)
      .in("page_id", pageIds),
  ]);
  if (versionsRes.error) return { rows: [], error: versionsRes.error.message };
  if (readsRes.error) return { rows: [], error: readsRes.error.message };

  const maxVersionByPage = new Map<string, number>();
  for (const v of versionsRes.data ?? []) {
    const cur = maxVersionByPage.get(v.page_id) ?? 0;
    if (v.version_number > cur) {
      maxVersionByPage.set(v.page_id, v.version_number);
    }
  }
  const maxReadByPage = new Map<string, number>();
  for (const r of readsRes.data ?? []) {
    const cur = maxReadByPage.get(r.page_id) ?? 0;
    if (r.read_version > cur) {
      maxReadByPage.set(r.page_id, r.read_version);
    }
  }

  const rows: KbRequiredUnreadRow[] = pages
    .filter((p) => {
      // Если ни одной версии нет (теоретически, страница без save'ов)
      // — fallback'ом считаем version=1, тот же что в migration default'е.
      const currentVersion = maxVersionByPage.get(p.id) ?? 1;
      const myReadVersion = maxReadByPage.get(p.id) ?? 0;
      // Юзер прочитал ТЕКУЩУЮ версию ⟺ max(read_version) >= current.
      return myReadVersion < currentVersion;
    })
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
