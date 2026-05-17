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
  /** Конкретный календарный месяц 'YYYY-MM' — переопределяет period
   *  (окно = весь месяц по UTC). */
  monthKey?: string;
  limit?: number;
}): Promise<{ rows: KbAnalyticsTopPage[]; error: string | null }> {
  const supabase = await createClient();
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
  const { sinceISO, untilISO } = resolveWindow(args);

  // Простая агрегация on-the-fly. Если станет узким местом в проде —
  // заменим на materialized view + scheduled REFRESH.
  // PostgREST не умеет SUM / COUNT через .select() с aggregate-функциями,
  // поэтому делаем это через RPC. Но RPC ещё нет → пока пишем
  // server-side aggregation: тянем сырьё, группируем в JS.
  // Это OK на ~1k страниц / month; для 10k+ нужен RPC.
  let q = supabase
    .from("kb_page_view_sessions")
    .select("page_id, duration_seconds, user_id")
    .gte("started_at", sinceISO);
  if (untilISO) q = q.lt("started_at", untilISO);
  const { data, error } = await q;

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
  /** Конкретный месяц 'YYYY-MM' — переопределяет period. */
  monthKey?: string;
  limit?: number;
}): Promise<{ rows: KbAnalyticsTopUser[]; error: string | null }> {
  const supabase = await createClient();
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
  const { sinceISO, untilISO } = resolveWindow(args);

  let q = supabase
    .from("kb_page_view_sessions")
    .select("user_id, duration_seconds, page_id")
    .gte("started_at", sinceISO);
  if (untilISO) q = q.lt("started_at", untilISO);
  const { data, error } = await q;

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
  /** Конкретный месяц 'YYYY-MM' — переопределяет period. */
  monthKey?: string;
}): Promise<{ rows: KbAnalyticsPageViewer[]; error: string | null }> {
  const supabase = await createClient();
  const { sinceISO, untilISO } = resolveWindow(args);

  let q = supabase
    .from("kb_page_view_sessions")
    .select("user_id, duration_seconds, started_at")
    .eq("page_id", args.pageId)
    .gte("started_at", sinceISO);
  if (untilISO) q = q.lt("started_at", untilISO);
  const { data, error } = await q;

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

export interface KbAnalyticsSummary {
  /** Живых (не deleted) страниц всего. */
  totalPages: number;
  /** Создано за выбранный период. */
  newInPeriod: number;
  /** Уникальных читателей за период. */
  activeReaders: number;
  /** Среднее время одной сессии за период, секунд (0 если сессий нет). */
  avgSessionSeconds: number;
}

/** KPI-сводка для дашборда аналитики (карточки sheerly `hL8wQ`).
 *  JS-агрегация — как и остальной analytics.ts; гейт `kb.view_analytics`
 *  на уровне RLS. must-read покрытие считается отдельно
 *  (`getKbRequiredReadingCoverage`) — разная природа данных. */
export async function getKbAnalyticsSummary(args: {
  period: KbAnalyticsPeriod;
  /** Конкретный месяц 'YYYY-MM' — переопределяет period. */
  monthKey?: string;
}): Promise<{ summary: KbAnalyticsSummary; error: string | null }> {
  const supabase = await createClient();
  const { sinceISO, untilISO } = resolveWindow(args);

  let newQ = supabase
    .from("kb_pages")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .gte("created_at", sinceISO);
  if (untilISO) newQ = newQ.lt("created_at", untilISO);
  let sessQ = supabase
    .from("kb_page_view_sessions")
    .select("user_id, duration_seconds")
    .gte("started_at", sinceISO);
  if (untilISO) sessQ = sessQ.lt("started_at", untilISO);

  const [totalRes, newRes, sessionsRes] = await Promise.all([
    supabase
      .from("kb_pages")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null),
    newQ,
    sessQ,
  ]);

  const firstError =
    totalRes.error?.message ??
    newRes.error?.message ??
    sessionsRes.error?.message ??
    null;
  if (firstError) {
    return {
      summary: {
        totalPages: 0,
        newInPeriod: 0,
        activeReaders: 0,
        avgSessionSeconds: 0,
      },
      error: firstError,
    };
  }

  const sessions = (sessionsRes.data ?? []) as {
    user_id: string;
    duration_seconds: number;
  }[];
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
      avgSessionSeconds:
        sessions.length > 0
          ? Math.round(totalSeconds / sessions.length)
          : 0,
    },
    error: null,
  };
}

function dayMs(period: KbAnalyticsPeriod): number {
  const days =
    period === "day" ? 1 : period === "week" ? 7 : 30;
  return days * 24 * 60 * 60 * 1000;
}

/** Окно агрегации. `monthKey='YYYY-MM'` → весь календарный месяц по
 *  UTC `[1-е 00:00, 1-е след. месяца)`. Иначе — скользящее окно
 *  `[now - period, now)` (untilISO=null, верхняя граница не нужна). */
function resolveWindow(args: {
  period: KbAnalyticsPeriod;
  monthKey?: string;
}): { sinceISO: string; untilISO: string | null } {
  const mk = args.monthKey;
  if (mk && /^\d{4}-(0[1-9]|1[0-2])$/.test(mk)) {
    const [y, m] = mk.split("-").map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    return { sinceISO: from.toISOString(), untilISO: to.toISOString() };
  }
  return {
    sinceISO: new Date(Date.now() - dayMs(args.period)).toISOString(),
    untilISO: null,
  };
}

export interface KbAnalyticsMonthlyPoint {
  /** 'YYYY-MM' (UTC). */
  monthKey: string;
  /** Человекочитаемая метка, напр. «апр 2026». */
  label: string;
  totalSeconds: number;
  sessionCount: number;
  uniqueReaders: number;
  /** Текущий (незавершённый) месяц — UI помечает «в процессе». */
  isCurrent: boolean;
}

/** Помесячный тренд активности за последние `months` календарных
 *  месяцев (включая пустые — для ровного графика). JS-агрегация по
 *  UTC-месяцу, как остальной analytics.ts; гейт `kb.view_analytics`
 *  на уровне RLS. Используется блоком-трендом на дашборде и как
 *  селектор месяца (клик по столбцу → ?month=YYYY-MM). */
export async function getKbMonthlyTrend(args?: {
  months?: number;
}): Promise<{ rows: KbAnalyticsMonthlyPoint[]; error: string | null }> {
  const months = Math.min(Math.max(args?.months ?? 12, 1), 24);
  const supabase = await createClient();

  const now = new Date();
  // Нижний край скользящего окна (UTC) — для старых аккаунтов график
  // не растёт бесконечно, остаётся ≤ `months` столбцов.
  const windowStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1),
  );

  // Не показываем месяцы до создания аккаунта: у свежего заведения
  // первый столбец — месяц регистрации, а не пустой прошлый год.
  // Стартовый месяц = более поздний из (windowStart, месяц created_at).
  // Если account/created_at недоступны — fallback на полное окно.
  let startMonth = windowStart;
  const { data: accountId } = await supabase.rpc("get_active_account_id");
  if (accountId) {
    const { data: accountRow } = await supabase
      .from("accounts")
      .select("created_at")
      .eq("id", accountId as unknown as string)
      .maybeSingle();
    const createdAt = accountRow?.created_at
      ? new Date(accountRow.created_at as string)
      : null;
    if (createdAt && Number.isFinite(createdAt.getTime())) {
      const createdMonth = new Date(
        Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), 1),
      );
      if (createdMonth.getTime() > startMonth.getTime()) {
        startMonth = createdMonth;
      }
    }
  }

  // Кол-во столбцов от стартового месяца до текущего включительно
  // (≥ 1 — текущий месяц есть всегда).
  const monthSpan =
    (now.getUTCFullYear() - startMonth.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - startMonth.getUTCMonth()) +
    1;
  const visibleMonths = Math.min(Math.max(monthSpan, 1), months);
  const curKey = monthKeyOf(now);

  const { data, error } = await supabase
    .from("kb_page_view_sessions")
    .select("started_at, duration_seconds, user_id")
    .gte("started_at", startMonth.toISOString());
  if (error) return { rows: [], error: error.message };

  const agg = new Map<
    string,
    { total: number; sessions: number; readers: Set<string> }
  >();
  for (const row of data ?? []) {
    const r = row as {
      started_at: string;
      duration_seconds: number;
      user_id: string;
    };
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

  const rows: KbAnalyticsMonthlyPoint[] = [];
  for (let i = 0; i < visibleMonths; i++) {
    const d = new Date(
      Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + i, 1),
    );
    const key = monthKeyOf(d);
    const e = agg.get(key);
    rows.push({
      monthKey: key,
      label: d.toLocaleDateString("ru-RU", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }),
      totalSeconds: e?.total ?? 0,
      sessionCount: e?.sessions ?? 0,
      uniqueReaders: e?.readers.size ?? 0,
      isCurrent: key === curKey,
    });
  }
  return { rows, error: null };
}

function monthKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
