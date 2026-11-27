"use server";

import { createClient } from "@/lib/supabase/server";
import { chunk, fetchAllRows } from "@/lib/supabase/fetch-all";
import type { LooseQuery } from "@/lib/supabase/loose";

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

/** Окно агрегации `[since, until)`; `until = null` — до сейчас. */
export type KbAnalyticsWindow = { sinceISO: string; untilISO: string | null };

type SessionRow = {
  id: string;
  page_id: string;
  user_id: string;
  started_at: string;
  duration_seconds: number;
};

/** Все сессии просмотра за окно. PostgREST отдаёт не больше 1000 строк и
 *  молча режет остальное — читаем постранично (CLAUDE.md, fetchAllRows). */
async function loadSessions(
  window: KbAnalyticsWindow,
  pageId?: string,
): Promise<SessionRow[]> {
  const supabase = await createClient();
  return fetchAllRows<SessionRow>(() => {
    let q = supabase
      .from("kb_page_view_sessions")
      .select("id, page_id, user_id, started_at, duration_seconds")
      .gte("started_at", window.sinceISO);
    if (window.untilISO) q = q.lt("started_at", window.untilISO);
    if (pageId) q = q.eq("page_id", pageId);
    return q as unknown as LooseQuery<SessionRow[]>;
  });
}

type PageMeta = { slug: string; title: string; icon: string | null; icon_color: string | null };

async function loadPageMeta(ids: string[]): Promise<Map<string, PageMeta>> {
  const supabase = await createClient();
  const meta = new Map<string, PageMeta>();
  for (const part of chunk(ids, 200)) {
    const { data, error } = await supabase
      .from("kb_pages")
      .select("id, slug, title, icon, icon_color")
      .in("id", part)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);
    for (const p of data ?? []) {
      meta.set(p.id, { slug: p.slug, title: p.title, icon: p.icon, icon_color: p.icon_color });
    }
  }
  return meta;
}

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

/** Страницы по суммарному времени чтения за окно («Популярное за период»,
 *  вид «По страницам»). Гейт `kb.view_analytics` — RLS на сессиях. */
export async function getKbAnalyticsTopPages(args: {
  window: KbAnalyticsWindow;
  /** Без лимита — все читавшиеся страницы. */
  limit?: number;
}): Promise<{ rows: KbAnalyticsTopPage[]; error: string | null }> {
  try {
    const sessions = await loadSessions(args.window);
    const byPage = new Map<string, { total: number; users: Set<string>; sessions: number }>();
    for (const r of sessions) {
      let entry = byPage.get(r.page_id);
      if (!entry) {
        entry = { total: 0, users: new Set(), sessions: 0 };
        byPage.set(r.page_id, entry);
      }
      entry.total += r.duration_seconds;
      entry.users.add(r.user_id);
      entry.sessions += 1;
    }
    const sorted = [...byPage.entries()].sort((a, b) => b[1].total - a[1].total);
    const ids = (args.limit ? sorted.slice(0, args.limit) : sorted).map(([id]) => id);
    if (ids.length === 0) return { rows: [], error: null };
    const meta = await loadPageMeta(ids);
    const rows = ids.flatMap((id): KbAnalyticsTopPage[] => {
      const m = meta.get(id);
      const stats = byPage.get(id)!;
      if (!m) return [];
      return [
        {
          page_id: id,
          ...m,
          total_seconds: stats.total,
          unique_viewers: stats.users.size,
          session_count: stats.sessions,
        },
      ];
    });
    return { rows, error: null };
  } catch (e) {
    return { rows: [], error: (e as Error).message };
  }
}

export interface KbAnalyticsPageViewer {
  user_id: string;
  name: string;
  avatar_url: string | null;
  total_seconds: number;
  session_count: number;
  last_visit_at: string;
}

/** Кто читал одну страницу за окно: время, визиты, последний заход. */
export async function getKbAnalyticsPageViewers(args: {
  pageId: string;
  window: KbAnalyticsWindow;
}): Promise<{ rows: KbAnalyticsPageViewer[]; error: string | null }> {
  try {
    const sessions = await loadSessions(args.window, args.pageId);
    const byUser = new Map<string, { total: number; sessions: number; lastVisit: string }>();
    for (const r of sessions) {
      let entry = byUser.get(r.user_id);
      if (!entry) {
        entry = { total: 0, sessions: 0, lastVisit: r.started_at };
        byUser.set(r.user_id, entry);
      }
      entry.total += r.duration_seconds;
      entry.sessions += 1;
      if (r.started_at > entry.lastVisit) entry.lastVisit = r.started_at;
    }
    const ids = [...byUser.entries()].sort((a, b) => b[1].total - a[1].total).map(([id]) => id);
    if (ids.length === 0) return { rows: [], error: null };

    const supabase = await createClient();
    const names = new Map<string, { name: string; avatar_url: string | null }>();
    for (const part of chunk(ids, 200)) {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, avatar_url")
        .in("id", part);
      if (error) throw new Error(error.message);
      for (const p of data ?? []) {
        const parts = [p.first_name, p.last_name].filter(Boolean) as string[];
        names.set(p.id, { name: parts.length > 0 ? parts.join(" ") : "—", avatar_url: p.avatar_url ?? null });
      }
    }
    const rows = ids.map((id) => {
      const stats = byUser.get(id)!;
      const who = names.get(id) ?? { name: "—", avatar_url: null };
      return {
        user_id: id,
        ...who,
        total_seconds: stats.total,
        session_count: stats.sessions,
        last_visit_at: stats.lastVisit,
      };
    });
    return { rows, error: null };
  } catch (e) {
    return { rows: [], error: (e as Error).message };
  }
}

export interface KbAnalyticsSummary {
  /** Живых (не удалённых) страниц всего. */
  totalPages: number;
  /** Создано за окно. */
  newInPeriod: number;
  /** Уникальных читателей за окно. */
  activeReaders: number;
  /** Суммарное время чтения за окно, секунд. */
  totalSeconds: number;
  /** Сессий просмотра за окно. */
  sessions: number;
}

/** Сводка за окно для показателей «Обзора». */
export async function getKbAnalyticsSummary(args: {
  window: KbAnalyticsWindow;
}): Promise<{ summary: KbAnalyticsSummary | null; error: string | null }> {
  try {
    const supabase = await createClient();
    let newQ = supabase
      .from("kb_pages")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .gte("created_at", args.window.sinceISO);
    if (args.window.untilISO) newQ = newQ.lt("created_at", args.window.untilISO);
    const [totalRes, newRes, sessions] = await Promise.all([
      supabase.from("kb_pages").select("id", { count: "exact", head: true }).is("deleted_at", null),
      newQ,
      loadSessions(args.window),
    ]);
    const firstError = totalRes.error?.message ?? newRes.error?.message ?? null;
    if (firstError) return { summary: null, error: firstError };
    const readers = new Set<string>();
    let totalSeconds = 0;
    for (const s of sessions) {
      readers.add(s.user_id);
      totalSeconds += s.duration_seconds;
    }
    return {
      summary: {
        totalPages: totalRes.count ?? 0,
        newInPeriod: newRes.count ?? 0,
        activeReaders: readers.size,
        totalSeconds,
        sessions: sessions.length,
      },
      error: null,
    };
  } catch (e) {
    return { summary: null, error: (e as Error).message };
  }
}

export interface KbAnalyticsMonthlyPoint {
  /** 'YYYY-MM' (UTC). */
  monthKey: string;
  totalSeconds: number;
  sessionCount: number;
  uniqueReaders: number;
}

/** Помесячная активность за последние `months` месяцев (не раньше
 *  создания аккаунта) для «По месяцам». Пустые месяцы — нулями. */
export async function getKbMonthlyTrend(args?: {
  months?: number;
}): Promise<{ rows: KbAnalyticsMonthlyPoint[]; error: string | null }> {
  const months = Math.min(Math.max(args?.months ?? 12, 1), 24);
  try {
    const supabase = await createClient();
    const now = new Date();
    let startMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
    const { data: accountId } = await supabase.rpc("get_active_account_id");
    if (accountId) {
      const { data: accountRow } = await supabase
        .from("accounts")
        .select("created_at")
        .eq("id", accountId as unknown as string)
        .maybeSingle();
      const createdAt = accountRow?.created_at ? new Date(accountRow.created_at as string) : null;
      if (createdAt && Number.isFinite(createdAt.getTime())) {
        const createdMonth = new Date(Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), 1));
        if (createdMonth > startMonth) startMonth = createdMonth;
      }
    }
    const sessions = await loadSessions({ sinceISO: startMonth.toISOString(), untilISO: null });
    const agg = new Map<string, { total: number; sessions: number; readers: Set<string> }>();
    for (const r of sessions) {
      const key = monthKeyOf(new Date(r.started_at));
      let e = agg.get(key);
      if (!e) {
        e = { total: 0, sessions: 0, readers: new Set() };
        agg.set(key, e);
      }
      e.total += r.duration_seconds;
      e.sessions += 1;
      e.readers.add(r.user_id);
    }
    const span =
      (now.getUTCFullYear() - startMonth.getUTCFullYear()) * 12 +
      (now.getUTCMonth() - startMonth.getUTCMonth()) +
      1;
    const rows: KbAnalyticsMonthlyPoint[] = [];
    for (let i = 0; i < Math.min(Math.max(span, 1), months); i++) {
      const key = monthKeyOf(new Date(Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + i, 1)));
      const e = agg.get(key);
      rows.push({
        monthKey: key,
        totalSeconds: e?.total ?? 0,
        sessionCount: e?.sessions ?? 0,
        uniqueReaders: e?.readers.size ?? 0,
      });
    }
    return { rows, error: null };
  } catch (e) {
    return { rows: [], error: (e as Error).message };
  }
}

function monthKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
