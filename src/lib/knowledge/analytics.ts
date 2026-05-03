"use server";

import { createClient } from "@/lib/supabase/server";

// ============================================================
// Sprint D / Phase 1 — Page-time analytics server actions.
//
// Связка: client-side `useKbPageViewTracker` (см. соседний
// use-page-view-tracker.ts) пишет сессии через `recordKbPageView` →
// RPC `kb_record_page_view` (миграция 077). Admin-dashboard читает
// аггрегаты через `getKbAnalyticsTopPages` / `getKbAnalyticsTopUsers`
// / `getKbAnalyticsPageViewers` — все три гейтятся `kb.view_analytics`
// на уровне RLS (миграция 077, см. SELECT-policy).
// ============================================================

/** Запись one-shot сессии просмотра. Вызывается из client'а на
 *  visibilitychange='hidden' / pagehide / unmount.
 *
 *  Duration считается СЕРВЕРОМ из p_started_at / p_ended_at — клиенту
 *  не доверяем (Codex #57 P1 #1: caller мог бы послать произвольное
 *  число и накрутить top-N виджеты).
 *
 *  Возвращает `{ ok }` без id-сессии: client'у не нужен round-trip,
 *  это fire-and-forget. Ошибки игнорируем тихо (analytics — не
 *  блокирующий flow для юзера). */
export async function recordKbPageView(args: {
  pageId: string;
  startedAt: string;
  endedAt: string;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();

  const startMs = new Date(args.startedAt).getTime();
  const endMs = new Date(args.endedAt).getTime();
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs < startMs
  ) {
    return { ok: false, error: "Invalid timestamps" };
  }

  const { error } = await supabase.rpc("kb_record_page_view", {
    p_page_id: args.pageId,
    p_started_at: args.startedAt,
    p_ended_at: args.endedAt,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ------------------------------------------------------------
// Admin-dashboard helpers.
// Потребитель — owner / admin / manager c kb.view_analytics. Без
// permission'а supabase вернёт пустые наборы из-за RLS — UI
// дополнительно прячет страницу через серверную проверку permission'а.
// ------------------------------------------------------------

export type KbAnalyticsPeriod = "day" | "week" | "month";

export interface KbAnalyticsTopPage {
  page_id: string;
  slug: string;
  title: string;
  icon: string | null;
  icon_color: string | null;
  total_seconds: number;
  unique_viewers: number;
  session_count: number;
}

/** Топ-страниц по суммарному времени в окне `period`.
 *  Используется на /knowledge/analytics в виджете «Самые читаемые». */
export async function getKbAnalyticsTopPages(args: {
  period: KbAnalyticsPeriod;
  limit?: number;
}): Promise<{ rows: KbAnalyticsTopPage[]; error: string | null }> {
  const supabase = await createClient();
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
  const sinceISO = new Date(
    Date.now() - dayMs(args.period),
  ).toISOString();

  // Простая агрегация on-the-fly. Если станет узким местом в проде —
  // заменим на materialized view + scheduled REFRESH.
  // PostgREST не умеет SUM / COUNT через .select() с aggregate-функциями,
  // поэтому делаем это через RPC. Но RPC ещё нет → пока пишем
  // server-side aggregation: тянем сырьё, группируем в JS.
  // Это OK на ~1k страниц / month; для 10k+ нужен RPC.
  const { data, error } = await supabase
    .from("kb_page_view_sessions")
    .select("page_id, duration_seconds, user_id")
    .gte("started_at", sinceISO);

  if (error) return { rows: [], error: error.message };

  const byPage = new Map<
    string,
    { total: number; users: Set<string>; sessions: number }
  >();
  for (const row of data ?? []) {
    const r = row as {
      page_id: string;
      duration_seconds: number;
      user_id: string;
    };
    let entry = byPage.get(r.page_id);
    if (!entry) {
      entry = { total: 0, users: new Set(), sessions: 0 };
      byPage.set(r.page_id, entry);
    }
    entry.total += r.duration_seconds;
    entry.users.add(r.user_id);
    entry.sessions += 1;
  }

  const sortedIds = [...byPage.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, limit)
    .map(([id]) => id);

  if (sortedIds.length === 0) return { rows: [], error: null };

  const { data: pages, error: pagesError } = await supabase
    .from("kb_pages")
    .select("id, slug, title, icon, icon_color")
    .in("id", sortedIds)
    .is("deleted_at", null);

  if (pagesError) return { rows: [], error: pagesError.message };

  const pageMeta = new Map(
    (pages ?? []).map((p) => [
      p.id,
      {
        slug: p.slug,
        title: p.title,
        icon: p.icon,
        icon_color: p.icon_color,
      },
    ]),
  );

  const rows: KbAnalyticsTopPage[] = sortedIds
    .map((id) => {
      const meta = pageMeta.get(id);
      const stats = byPage.get(id)!;
      if (!meta) return null;
      return {
        page_id: id,
        slug: meta.slug,
        title: meta.title,
        icon: meta.icon,
        icon_color: meta.icon_color,
        total_seconds: stats.total,
        unique_viewers: stats.users.size,
        session_count: stats.sessions,
      };
    })
    .filter((r): r is KbAnalyticsTopPage => r !== null);

  return { rows, error: null };
}

export interface KbAnalyticsTopUser {
  user_id: string;
  name: string;
  avatar_url: string | null;
  total_seconds: number;
  unique_pages: number;
  session_count: number;
}

/** Топ-юзеров по активности в окне `period`. Виджет «Самые активные». */
export async function getKbAnalyticsTopUsers(args: {
  period: KbAnalyticsPeriod;
  limit?: number;
}): Promise<{ rows: KbAnalyticsTopUser[]; error: string | null }> {
  const supabase = await createClient();
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
  const sinceISO = new Date(
    Date.now() - dayMs(args.period),
  ).toISOString();

  const { data, error } = await supabase
    .from("kb_page_view_sessions")
    .select("user_id, duration_seconds, page_id")
    .gte("started_at", sinceISO);

  if (error) return { rows: [], error: error.message };

  const byUser = new Map<
    string,
    { total: number; pages: Set<string>; sessions: number }
  >();
  for (const row of data ?? []) {
    const r = row as {
      user_id: string;
      duration_seconds: number;
      page_id: string;
    };
    let entry = byUser.get(r.user_id);
    if (!entry) {
      entry = { total: 0, pages: new Set(), sessions: 0 };
      byUser.set(r.user_id, entry);
    }
    entry.total += r.duration_seconds;
    entry.pages.add(r.page_id);
    entry.sessions += 1;
  }

  const sortedIds = [...byUser.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, limit)
    .map(([id]) => id);

  if (sortedIds.length === 0) return { rows: [], error: null };

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, avatar_url")
    .in("id", sortedIds);

  if (profilesError) return { rows: [], error: profilesError.message };

  const profileMeta = new Map(
    (profiles ?? []).map((p) => {
      const parts = [p.first_name, p.last_name].filter(Boolean) as string[];
      return [
        p.id,
        {
          name: parts.length > 0 ? parts.join(" ") : "—",
          avatar_url: p.avatar_url ?? null,
        },
      ];
    }),
  );

  const rows: KbAnalyticsTopUser[] = sortedIds.map((id) => {
    const meta = profileMeta.get(id) ?? { name: "—", avatar_url: null };
    const stats = byUser.get(id)!;
    return {
      user_id: id,
      name: meta.name,
      avatar_url: meta.avatar_url,
      total_seconds: stats.total,
      unique_pages: stats.pages.size,
      session_count: stats.sessions,
    };
  });

  return { rows, error: null };
}

export interface KbAnalyticsPageViewer {
  user_id: string;
  name: string;
  avatar_url: string | null;
  total_seconds: number;
  session_count: number;
  last_visit_at: string;
}

/** Per-page drill-down: список юзеров, читавших конкретную страницу,
 *  с суммарным временем и last-visit. Используется в /knowledge/analytics
 *  при click'е на строку «Топ-страниц». */
export async function getKbAnalyticsPageViewers(args: {
  pageId: string;
  period: KbAnalyticsPeriod;
}): Promise<{ rows: KbAnalyticsPageViewer[]; error: string | null }> {
  const supabase = await createClient();
  const sinceISO = new Date(
    Date.now() - dayMs(args.period),
  ).toISOString();

  const { data, error } = await supabase
    .from("kb_page_view_sessions")
    .select("user_id, duration_seconds, started_at")
    .eq("page_id", args.pageId)
    .gte("started_at", sinceISO);

  if (error) return { rows: [], error: error.message };

  const byUser = new Map<
    string,
    { total: number; sessions: number; lastVisit: string }
  >();
  for (const row of data ?? []) {
    const r = row as {
      user_id: string;
      duration_seconds: number;
      started_at: string;
    };
    let entry = byUser.get(r.user_id);
    if (!entry) {
      entry = { total: 0, sessions: 0, lastVisit: r.started_at };
      byUser.set(r.user_id, entry);
    }
    entry.total += r.duration_seconds;
    entry.sessions += 1;
    if (r.started_at > entry.lastVisit) entry.lastVisit = r.started_at;
  }

  const sortedIds = [...byUser.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([id]) => id);

  if (sortedIds.length === 0) return { rows: [], error: null };

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, avatar_url")
    .in("id", sortedIds);

  if (profilesError) return { rows: [], error: profilesError.message };

  const profileMeta = new Map(
    (profiles ?? []).map((p) => {
      const parts = [p.first_name, p.last_name].filter(Boolean) as string[];
      return [
        p.id,
        {
          name: parts.length > 0 ? parts.join(" ") : "—",
          avatar_url: p.avatar_url ?? null,
        },
      ];
    }),
  );

  const rows: KbAnalyticsPageViewer[] = sortedIds.map((id) => {
    const meta = profileMeta.get(id) ?? { name: "—", avatar_url: null };
    const stats = byUser.get(id)!;
    return {
      user_id: id,
      name: meta.name,
      avatar_url: meta.avatar_url,
      total_seconds: stats.total,
      session_count: stats.sessions,
      last_visit_at: stats.lastVisit,
    };
  });

  return { rows, error: null };
}

function dayMs(period: KbAnalyticsPeriod): number {
  const days =
    period === "day" ? 1 : period === "week" ? 7 : 30;
  return days * 24 * 60 * 60 * 1000;
}
