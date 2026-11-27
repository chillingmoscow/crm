"use server";

import { createClient, getCachedUser } from "@/lib/supabase/server";
import { chunk } from "@/lib/supabase/fetch-all";
import { kbReadingStatus } from "@/lib/knowledge/reading-state";

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
  /** Читал раньше, но менеджер попросил перечитать — бейдж «Обновлено». */
  reread: boolean;
}

export interface KbRecentlyViewedRow extends KbLandingPageRow {
  /** ISO timestamp последнего визита. Используется для сортировки и
   *  опционально для «5 мин назад» подписи. */
  last_visit_at: string;
}

/** Обязательные страницы, которые текущий пользователь ещё не прочитал
 *  или которые его попросили перечитать (`reread`). Сортировка: сначала
 *  свежие (по updated_at страницы — proxy для «когда стало обязательным»).
 *
 *  Прочтение действует по правилу `kbReadIsCurrent` (миграция 416):
 *  правка страницы его не сбрасывает, только просьба менеджера.
 *  RLS на kb_pages фильтрует чтение по `kb.view_pages`; без права — []. */
export async function getKbRequiredUnreadForUser(): Promise<{
  rows: KbRequiredUnreadRow[];
  /** Сколько всего обязательных страниц в аккаунте (для счётчика в дереве
   *  и прогресса на главной — без отдельного count-запроса). */
  total: number;
  error: string | null;
}> {
  const supabase = await createClient();
  const user = await getCachedUser();
  if (!user) return { rows: [], total: 0, error: null };

  const { data: pages, error: pagesError } = await supabase
    .from("kb_pages")
    .select("id, slug, title, icon, icon_color, updated_at")
    .eq("required_reading", true)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false, nullsFirst: false });
  if (pagesError) return { rows: [], total: 0, error: pagesError.message };
  if (!pages || pages.length === 0) return { rows: [], total: 0, error: null };

  // Обязательных страниц — десятки, а не тысячи; id режем на части, чтобы
  // длинный список не упёрся в длину адреса запроса.
  const pageIds = pages.map((p) => p.id);
  const rereadFrom = new Map<string, number | null>();
  const myReadVersion = new Map<string, number>();
  for (const ids of chunk(pageIds, 200)) {
    const [stateRes, readsRes] = await Promise.all([
      supabase
        .from("kb_page_reading_state")
        .select("page_id, reread_from_version")
        .in("page_id", ids),
      supabase
        .from("kb_page_reads")
        .select("page_id, read_version")
        .eq("user_id", user.id)
        .in("page_id", ids),
    ]);
    if (stateRes.error) return { rows: [], total: pages.length, error: stateRes.error.message };
    if (readsRes.error) return { rows: [], total: pages.length, error: readsRes.error.message };
    for (const st of stateRes.data ?? []) rereadFrom.set(st.page_id, st.reread_from_version);
    for (const r of readsRes.data ?? []) {
      myReadVersion.set(r.page_id, Math.max(myReadVersion.get(r.page_id) ?? 0, r.read_version));
    }
  }

  const rows: KbRequiredUnreadRow[] = [];
  for (const p of pages) {
    const status = kbReadingStatus(myReadVersion.get(p.id) ?? null, rereadFrom.get(p.id) ?? null);
    if (status === "read") continue;
    rows.push({
      id: p.id,
      slug: p.slug,
      title: p.title,
      icon: p.icon,
      icon_color: p.icon_color,
      required_since: (p.updated_at as string | null) ?? new Date().toISOString(),
      reread: status === "reread",
    });
  }
  return { rows, total: pages.length, error: null };
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
