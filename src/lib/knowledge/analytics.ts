"use server";

import { createClient } from "@/lib/supabase/server";
import { getActiveAccountTimezone } from "@/lib/settings/account";
import { calendarDateInZone, dayStartInZone } from "@/lib/format/zoned-day";
import { chunk, fetchAllRows } from "@/lib/supabase/fetch-all";
import type { LooseQuery } from "@/lib/supabase/loose";

// ============================================================
// Sprint D / Phase 1 — Page-time analytics server actions.
//
// Связка: client-side `useKbPageViewTracker` (см. соседний
// use-page-view-tracker.ts) пишет сессии через `recordKbPageView` →
// RPC `kb_record_page_view` (миграция 077). «Обзор» читает суммы через
// RPC kb_analytics_page_stats / kb_analytics_month_stats /
// kb_analytics_window_totals (миграция 416), «Статистика страницы» —
// `getKbAnalyticsPageViewers`. Всё под `kb.view_analytics` (RLS сессий и
// явная проверка права в итогах окна).
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

/** Сессии одной страницы за окно — для «Статистики страницы» (их немного,
 *  индекс page_id + started_at). PostgREST отдаёт не больше 1000 строк и
 *  молча режет остальное — читаем постранично (CLAUDE.md, fetchAllRows).
 *  Суммы по всем страницам считает база: kb_analytics_*. */
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
 *  вид «По страницам»). Суммы считает база (kb_analytics_page_stats), RLS
 *  сессий — `kb.view_analytics`. */
export async function getKbAnalyticsTopPages(args: {
  window: KbAnalyticsWindow;
  /** Без лимита — все читавшиеся страницы. */
  limit?: number;
}): Promise<{ rows: KbAnalyticsTopPage[]; error: string | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("kb_analytics_page_stats", {
      p_since: args.window.sinceISO,
      p_until: args.window.untilISO,
    });
    if (error) throw new Error(error.message);
    const sorted = [...(data ?? [])].sort((a, b) => b.total_seconds - a.total_seconds);
    const top = args.limit ? sorted.slice(0, args.limit) : sorted;
    if (top.length === 0) return { rows: [], error: null };
    const meta = await loadPageMeta(top.map((r) => r.page_id));
    const rows = top.flatMap((r): KbAnalyticsTopPage[] => {
      const m = meta.get(r.page_id);
      if (!m) return [];
      return [
        {
          page_id: r.page_id,
          ...m,
          total_seconds: Number(r.total_seconds),
          unique_viewers: Number(r.readers),
          session_count: Number(r.sessions),
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
  /** Уникальных читателей за окно (все, включая уволенных). */
  readers: number;
  /** Из них — в нынешнем составе (активные, с доступом к базе). */
  rosterReaders: number;
  /** Размер состава. */
  rosterTotal: number;
  /** Суммарное время чтения за окно, секунд. */
  totalSeconds: number;
  /** Сессий просмотра за окно. */
  sessions: number;
}

/** Итоги окна для показателей «Обзора» (kb_analytics_window_totals). */
export async function getKbAnalyticsSummary(args: {
  window: KbAnalyticsWindow;
}): Promise<{ summary: KbAnalyticsSummary | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kb_analytics_window_totals", {
    p_since: args.window.sinceISO,
    p_until: args.window.untilISO,
  });
  if (error) return { summary: null, error: error.message };
  const row = data?.[0];
  if (!row) return { summary: null, error: null };
  return {
    summary: {
      readers: Number(row.readers),
      rosterReaders: Number(row.roster_readers),
      rosterTotal: Number(row.roster_total),
      totalSeconds: Number(row.total_seconds),
      sessions: Number(row.sessions),
    },
    error: null,
  };
}

export interface KbAnalyticsMonthlyPoint {
  /** 'YYYY-MM' в поясе аккаунта. */
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
    // Месяцы — в поясе аккаунта (как группирует kb_analytics_month_stats с
    // миграции 421): `now` и `startMonth` — календарные метки этого пояса.
    const timeZone = await getActiveAccountTimezone();
    const now = new Date(`${calendarDateInZone(new Date().toISOString(), timeZone)}T00:00:00.000Z`);
    let startMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
    const { data: accountId } = await supabase.rpc("get_active_account_id");
    if (accountId) {
      const { data: accountRow } = await supabase
        .from("accounts")
        .select("created_at")
        .eq("id", accountId as unknown as string)
        .maybeSingle();
      const createdAt = accountRow?.created_at
        ? new Date(`${calendarDateInZone(accountRow.created_at as string, timeZone)}T00:00:00.000Z`)
        : null;
      if (createdAt && Number.isFinite(createdAt.getTime())) {
        const createdMonth = new Date(Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), 1));
        if (createdMonth > startMonth) startMonth = createdMonth;
      }
    }
    const { data, error } = await supabase.rpc("kb_analytics_month_stats", {
      p_since: dayStartInZone(startMonth.toISOString().slice(0, 10), timeZone),
    });
    if (error) throw new Error(error.message);
    const agg = new Map((data ?? []).map((r) => [r.month, r]));
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
        totalSeconds: Number(e?.total_seconds ?? 0),
        sessionCount: Number(e?.sessions ?? 0),
        uniqueReaders: Number(e?.readers ?? 0),
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
