import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { KbStatCard } from "@/components/knowledge/kb-stat-card";
import { KbSectionHeader } from "@/app/(dashboard)/knowledge/_components/kb-section-header";
import { KbTimeMetricHint } from "@/app/(dashboard)/knowledge/_components/kb-time-metric-hint";
import { KbMonthlyTrend } from "@/app/(dashboard)/knowledge/_components/kb-monthly-trend";
import {
  getKbAnalyticsSummary,
  getKbAnalyticsTopPages,
  getKbAnalyticsTopUsers,
  getKbMonthlyTrend,
  type KbAnalyticsPeriod,
} from "@/lib/knowledge/analytics";
import { getKbRequiredReadingCoverage } from "@/lib/knowledge/required-reading";
import { listKbAuditEvents } from "@/lib/knowledge/audit";
import { KbAnalyticsPeriodTabs } from "@/app/(dashboard)/knowledge/analytics/_components/kb-analytics-period-tabs";
import {
  KbAnalyticsViewTabs,
  type KbAnalyticsView,
} from "@/app/(dashboard)/knowledge/analytics/_components/kb-analytics-view-tabs";
import { KbAnalyticsTopPages } from "@/app/(dashboard)/knowledge/analytics/_components/kb-analytics-top-pages";
import { KbAnalyticsTopUsers } from "@/app/(dashboard)/knowledge/analytics/_components/kb-analytics-top-users";
import { KbAuditEventRow } from "@/app/(dashboard)/knowledge/audit/_components/kb-audit-event-row";

const VALID_PERIODS: KbAnalyticsPeriod[] = ["day", "week", "month"];
const PERIOD_LABEL: Record<KbAnalyticsPeriod, string> = {
  day: "за сутки",
  week: "за неделю",
  month: "за месяц",
};
const PERIOD_DAYS: Record<KbAnalyticsPeriod, number> = {
  day: 1,
  week: 7,
  month: 30,
};

/**
 * Дашборд базы знаний (sheerly `TvInj`/`hL8wQ`).
 *
 * Объединяет бывшие «Дашборд» и «Аналитику» в один экран (раньше
 * ~70% контента дублировалось). Сводка-метрики + топ читаемых
 * страниц + активные сотрудники + лента последних изменений + вид
 * «По страницам» с drill-down на `/knowledge/dashboard/[slug]`.
 *
 * Доступ: `kb.view_analytics` ∨ `org.view_audit` (иначе redirect
 * /knowledge). Под чистым `org.view_audit` analytics-блоки
 * деградируют в «нет доступа», лента изменений работает; под
 * чистым `kb.view_analytics` — наоборот (Codex #319 P2).
 *
 * URL-состояние shareable: `?p=day|week|month`, `?view=overview|pages`.
 * `/knowledge/analytics` 301-redirect'ится сюда (next.config).
 */
export default async function KbDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; view?: string; month?: string }>;
}) {
  const { p, view: viewParam, month: monthParam } = await searchParams;
  const period: KbAnalyticsPeriod = VALID_PERIODS.includes(
    p as KbAnalyticsPeriod,
  )
    ? (p as KbAnalyticsPeriod)
    : "week";
  const view: KbAnalyticsView = viewParam === "pages" ? "pages" : "overview";
  const isPages = view === "pages";
  // Конкретный календарный месяц 'YYYY-MM' переопределяет period
  // (снимок за месяц). Невалидное значение игнорируем.
  const monthKey =
    monthParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)
      ? monthParam
      : undefined;
  const windowLabel = monthKey
    ? `за ${formatMonthLabel(monthKey)}`
    : PERIOD_LABEL[period];

  const supabase = await createClient();
  const [{ data: canAnalytics }, { data: canAudit }] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "kb.view_analytics" }),
    supabase.rpc("has_permission", { permission_code: "org.view_audit" }),
  ]);
  if (!canAnalytics && !canAudit) redirect("/knowledge");

  // Окно для «Изменений» (audit): месяц или скользящий period.
  let sinceISO: string;
  let untilISO: string | null = null;
  if (monthKey) {
    const [yy, mm] = monthKey.split("-").map(Number);
    sinceISO = new Date(Date.UTC(yy, mm - 1, 1)).toISOString();
    untilISO = new Date(Date.UTC(yy, mm, 1)).toISOString();
  } else {
    sinceISO = new Date(
      Date.now() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000,
    ).toISOString();
  }

  // Запросы гейтятся по правам: под analytics-only audit-таблицы
  // RLS-фильтруются в ноль и наоборот. Нули как реальные данные =
  // ложный сигнал (Codex #319 P2). Нет права → не фетчим, блок =
  // «нет доступа».
  const [analyticsData, auditData, { coverage }] = await Promise.all([
    canAnalytics
      ? Promise.all([
          getKbAnalyticsSummary({ period, monthKey }),
          getKbAnalyticsTopPages({
            period,
            monthKey,
            limit: isPages ? 50 : 5,
          }),
          // «Активные сотрудники» рендерятся только в Обзоре — в виде
          // «По страницам» не фетчим (лишний DB-запрос + его ошибка
          // не должна всплывать в общем баннере; Codex #327 P2).
          isPages
            ? Promise.resolve(null)
            : getKbAnalyticsTopUsers({ period, monthKey, limit: 3 }),
          getKbMonthlyTrend({ months: 12 }),
        ])
      : Promise.resolve(null),
    canAudit
      ? Promise.all([
          listKbAuditEvents(),
          (() => {
            let q = supabase
              .from("audit_logs")
              .select("id", { count: "exact", head: true })
              .eq("entity_type", "kb_page")
              .gte("created_at", sinceISO);
            if (untilISO) q = q.lt("created_at", untilISO);
            return q;
          })(),
        ])
      : Promise.resolve(null),
    getKbRequiredReadingCoverage(),
  ]);

  const summary = analyticsData?.[0].summary ?? null;
  const summaryError = analyticsData?.[0].error ?? null;
  const topPages = analyticsData?.[1].rows ?? [];
  const pagesError = analyticsData?.[1].error ?? null;
  const topUsers = analyticsData?.[2]?.rows ?? [];
  const topUsersError = analyticsData?.[2]?.error ?? null;
  const monthlyTrend = analyticsData?.[3].rows ?? [];
  const recentEvents = auditData?.[0].events ?? [];
  const changesInPeriod: number | null = auditData?.[1].count ?? null;

  const coverageKnown =
    coverage.requiredPages > 0 && coverage.teamSize > 0;
  const pending = coverage.teamSize - coverage.done;
  const latestChanges = recentEvents.slice(0, 6);
  const loadError = summaryError ?? pagesError ?? topUsersError;

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-6 md:px-8 pt-4 pb-8 w-full">
        <div className="mx-auto w-full max-w-[1100px] flex flex-col gap-6">
          <KbSectionHeader
            title="Дашборд"
            description={
              <>
                Сводка по базе знаний: активность чтения, обязательное
                чтение и последние изменения.{" "}
                <span className="inline-flex items-center gap-1">
                  Как считается время
                  <KbTimeMetricHint />
                </span>
              </>
            }
            actions={
              <div className="flex flex-wrap items-center gap-3">
                <KbAnalyticsViewTabs
                  current={view}
                  period={period}
                  basePath="/knowledge/dashboard"
                />
                <KbAnalyticsPeriodTabs
                  current={period}
                  basePath="/knowledge/dashboard"
                  view={view}
                />
              </div>
            }
          />

          {loadError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              Не удалось загрузить аналитику: {loadError}
            </div>
          )}

          {/* KPI-сводка */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KbStatCard
              label="Всего страниц"
              value={summary ? summary.totalPages : "—"}
              hint={
                !summary
                  ? "нет доступа к аналитике"
                  : summary.newInPeriod > 0
                    ? `+${summary.newInPeriod} ${windowLabel}`
                    : "без новых за период"
              }
              hintTone={
                summary && summary.newInPeriod > 0 ? "positive" : "muted"
              }
            />
            <KbStatCard
              label="Активных читателей"
              value={summary ? summary.activeReaders : "—"}
              hint={
                !summary
                  ? "нет доступа к аналитике"
                  : coverage.teamSize > 0
                    ? `из ${coverage.teamSize} в команде`
                    : windowLabel
              }
            />
            <KbStatCard
              label="Среднее время чтения"
              value={summary ? formatMinutes(summary.avgSessionSeconds) : "—"}
              hint={
                summary
                  ? `сессия · ${windowLabel}`
                  : "нет доступа к аналитике"
              }
            />
            <KbStatCard
              label="Прочли must-read"
              value={
                coverageKnown
                  ? `${coverage.done} / ${coverage.teamSize}`
                  : "—"
              }
              hint={
                coverage.requiredPages === 0
                  ? "нет обязательных страниц"
                  : !coverageKnown
                    ? "нет доступа к статистике"
                    : pending > 0
                      ? `${pending} ${waitWord(pending)} прочтения`
                      : "все прочитали"
              }
              hintTone={
                !coverageKnown
                  ? "muted"
                  : pending > 0
                    ? "warning"
                    : "positive"
              }
            />
            <KbStatCard
              label="Изменений"
              value={changesInPeriod ?? "—"}
              hint={
                changesInPeriod === null
                  ? "нет доступа к журналу"
                  : windowLabel
              }
            />
          </div>

          {canAnalytics && monthlyTrend.length > 0 && (
            <KbMonthlyTrend
              rows={monthlyTrend}
              activeMonthKey={monthKey}
              basePath="/knowledge/dashboard"
            />
          )}

          {isPages ? (
            <section className="flex flex-col rounded-xl border bg-card overflow-hidden">
              <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3.5">
                <h2 className="text-sm font-semibold text-foreground">
                  Все страницы
                </h2>
                <span className="text-xs text-muted-foreground">
                  {windowLabel} · {topPages.length}
                </span>
              </div>
              <div className="p-2">
                {canAnalytics ? (
                  <KbAnalyticsTopPages rows={topPages} period={period} />
                ) : (
                  <p className="px-3 py-6 text-sm text-muted-foreground">
                    Нет доступа к аналитике.
                  </p>
                )}
              </div>
            </section>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1fr_minmax(320px,420px)]">
              <section className="flex flex-col rounded-xl border bg-card overflow-hidden">
                <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3.5">
                  <h2 className="text-sm font-semibold text-foreground">
                    Самые читаемые страницы
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {windowLabel} · топ-
                    {Math.min(topPages.length, 5) || 5}
                  </span>
                </div>
                <div className="p-2">
                  {canAnalytics ? (
                    <KbAnalyticsTopPages rows={topPages} period={period} />
                  ) : (
                    <p className="px-3 py-6 text-sm text-muted-foreground">
                      Нет доступа к аналитике.
                    </p>
                  )}
                </div>
              </section>

              <section className="flex flex-col rounded-xl border bg-card overflow-hidden">
                <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3.5">
                  <h2 className="text-sm font-semibold text-foreground">
                    Активные сотрудники
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    топ-{Math.min(topUsers.length, 3) || 3}
                  </span>
                </div>
                <div className="p-2">
                  {canAnalytics ? (
                    <KbAnalyticsTopUsers rows={topUsers} />
                  ) : (
                    <p className="px-3 py-6 text-sm text-muted-foreground">
                      Нет доступа к аналитике.
                    </p>
                  )}
                </div>
              </section>
            </div>
          )}

          <section className="flex flex-col rounded-xl border bg-card overflow-hidden">
            <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3.5">
              <h2 className="text-sm font-semibold text-foreground">
                Последние изменения
              </h2>
              {canAudit && (
                <Link
                  href="/knowledge/audit"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Весь журнал →
                </Link>
              )}
            </div>
            {!canAudit ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Нет доступа к журналу.
              </p>
            ) : latestChanges.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Пока нет изменений.
              </p>
            ) : (
              <ul className="flex flex-col">
                {latestChanges.map((event) => (
                  <KbAuditEventRow key={event.id} event={event} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function formatMinutes(seconds: number): string {
  if (seconds <= 0) return "—";
  const min = Math.round(seconds / 60);
  if (min < 1) return "<1 мин";
  return `${min} мин`;
}

/** 'YYYY-MM' → «апрель 2026» (UTC, как окно агрегации). */
function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function waitWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "ждут";
  if (mod10 === 1) return "ждёт";
  if (mod10 >= 2 && mod10 <= 4) return "ждут";
  return "ждут";
}
