import { redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import { KbStatCard } from "@/components/knowledge/kb-stat-card";
import {
  getKbAnalyticsSummary,
  getKbAnalyticsTopPages,
  getKbAnalyticsTopUsers,
  type KbAnalyticsPeriod,
} from "@/lib/knowledge/analytics";
import { getKbRequiredReadingCoverage } from "@/lib/knowledge/required-reading";
import { KbAnalyticsPeriodTabs } from "@/app/(dashboard)/knowledge/analytics/_components/kb-analytics-period-tabs";
import {
  KbAnalyticsViewTabs,
  type KbAnalyticsView,
} from "@/app/(dashboard)/knowledge/analytics/_components/kb-analytics-view-tabs";
import { KbAnalyticsTopPages } from "@/app/(dashboard)/knowledge/analytics/_components/kb-analytics-top-pages";
import { KbAnalyticsTopUsers } from "@/app/(dashboard)/knowledge/analytics/_components/kb-analytics-top-users";

const VALID_PERIODS: KbAnalyticsPeriod[] = ["day", "week", "month"];
const PERIOD_LABEL: Record<KbAnalyticsPeriod, string> = {
  day: "за сутки",
  week: "за неделю",
  month: "за месяц",
};

/**
 * Admin-dashboard аналитики базы знаний (sheerly `hL8wQ`).
 *
 * Доступ: `kb.view_analytics` (миграция 077). Без права — redirect
 * на /knowledge (пустой dashboard под сотрудником без права =
 * security through obscurity).
 *
 * URL-состояние: `?p=day|week|month` (период) и `?view=overview|pages`
 * (таб). Обе части shareable.
 *
 * Per-page drill-down (юзеры конкретной страницы со временем) — клик
 * по строке топ-страниц ведёт на `/knowledge/analytics/[slug]`.
 */
export default async function KbAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; view?: string }>;
}) {
  const { p, view: viewParam } = await searchParams;
  const period: KbAnalyticsPeriod = VALID_PERIODS.includes(
    p as KbAnalyticsPeriod,
  )
    ? (p as KbAnalyticsPeriod)
    : "week";
  const view: KbAnalyticsView = viewParam === "pages" ? "pages" : "overview";

  const supabase = await createClient();
  const { data: canView } = await supabase.rpc("has_permission", {
    permission_code: "kb.view_analytics",
  });
  if (!canView) redirect("/knowledge");

  const isPages = view === "pages";
  const [
    { summary, error: summaryError },
    { coverage },
    { rows: topPages, error: pagesError },
    topUsersRes,
  ] = await Promise.all([
    getKbAnalyticsSummary({ period }),
    getKbRequiredReadingCoverage(),
    getKbAnalyticsTopPages({ period, limit: isPages ? 50 : 5 }),
    isPages
      ? Promise.resolve(null)
      : getKbAnalyticsTopUsers({ period, limit: 3 }),
  ]);

  // Ошибку top-users тоже показываем в баннере: иначе сбой загрузки
  // молча выглядит как «нет активных сотрудников» (Codex #318 P2).
  const topUsersError = topUsersRes?.error ?? null;

  // teamSize === 0 при requiredPages > 0 = roster недоступен (нет
  // kb.manage_required_reading у зрителя) — показываем «—», а не
  // ложное «все прочитали».
  const coverageKnown =
    coverage.requiredPages > 0 && coverage.teamSize > 0;
  const pending = coverage.teamSize - coverage.done;

  return (
    <div className="flex-1 flex flex-col">
      <PageBreadcrumb>
        <span className="text-sm font-medium text-foreground inline-flex items-center gap-2">
          <BarChart3 className="size-4 text-muted-foreground" />
          Аналитика
        </span>
      </PageBreadcrumb>

      <div className="px-6 md:px-8 pt-6 pb-8 w-full flex flex-col gap-6">
        <div className="mx-auto w-full max-w-[1100px] flex flex-col gap-6">
          <header className="flex flex-col gap-2">
            <h1 className="text-[28px] font-extrabold tracking-tight">
              Аналитика базы знаний
            </h1>
            <p className="text-sm text-muted-foreground max-w-[680px]">
              Сколько времени сотрудники проводят в базе знаний.
              Учитывается активное время — без неактивных вкладок и
              idle-периодов
            </p>
          </header>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <KbAnalyticsViewTabs
              current={view}
              period={period}
              basePath="/knowledge/analytics"
            />
            <KbAnalyticsPeriodTabs
              current={period}
              basePath="/knowledge/analytics"
              view={view}
            />
          </div>

          {(summaryError || pagesError || topUsersError) && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              Не удалось загрузить аналитику:{" "}
              {summaryError ?? pagesError ?? topUsersError}
            </div>
          )}

          {/* KPI-сводка */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KbStatCard
              label="Всего страниц"
              value={summary.totalPages}
              hint={
                summary.newInPeriod > 0
                  ? `+${summary.newInPeriod} ${PERIOD_LABEL[period]}`
                  : "без новых за период"
              }
              hintTone={summary.newInPeriod > 0 ? "positive" : "muted"}
            />
            <KbStatCard
              label="Активных читателей"
              value={summary.activeReaders}
              hint={
                coverage.teamSize > 0
                  ? `из ${coverage.teamSize} в команде`
                  : PERIOD_LABEL[period]
              }
            />
            <KbStatCard
              label="Среднее время чтения"
              value={formatMinutes(summary.avgSessionSeconds)}
              hint={`сессия · ${PERIOD_LABEL[period]}`}
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
          </div>

          {isPages ? (
            <section className="flex flex-col rounded-xl border bg-card overflow-hidden">
              <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3.5">
                <h2 className="text-sm font-semibold text-foreground">
                  Все страницы
                </h2>
                <span className="text-xs text-muted-foreground">
                  {PERIOD_LABEL[period]} · {topPages.length}
                </span>
              </div>
              <div className="p-2">
                <KbAnalyticsTopPages rows={topPages} period={period} />
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
                    {PERIOD_LABEL[period]} · топ-
                    {Math.min(topPages.length, 5) || 5}
                  </span>
                </div>
                <div className="p-2">
                  <KbAnalyticsTopPages rows={topPages} period={period} />
                </div>
              </section>

              <section className="flex flex-col rounded-xl border bg-card overflow-hidden">
                <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3.5">
                  <h2 className="text-sm font-semibold text-foreground">
                    Активные сотрудники
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    топ-{Math.min(topUsersRes?.rows.length ?? 0, 3) || 3}
                  </span>
                </div>
                <div className="p-2">
                  <KbAnalyticsTopUsers rows={topUsersRes?.rows ?? []} />
                </div>
              </section>
            </div>
          )}
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

/** «ждёт» / «ждут» для остатка непрочитавших. */
function waitWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "ждут";
  if (mod10 === 1) return "ждёт";
  if (mod10 >= 2 && mod10 <= 4) return "ждут";
  return "ждут";
}
