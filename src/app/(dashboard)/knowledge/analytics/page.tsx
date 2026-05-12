import { redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import {
  getKbAnalyticsTopPages,
  getKbAnalyticsTopUsers,
  type KbAnalyticsPeriod,
} from "@/lib/knowledge/analytics";
import { KbAnalyticsPeriodTabs } from "@/app/(dashboard)/knowledge/analytics/_components/kb-analytics-period-tabs";
import { KbAnalyticsTopPages } from "@/app/(dashboard)/knowledge/analytics/_components/kb-analytics-top-pages";
import { KbAnalyticsTopUsers } from "@/app/(dashboard)/knowledge/analytics/_components/kb-analytics-top-users";

const VALID_PERIODS: KbAnalyticsPeriod[] = ["day", "week", "month"];
const PERIOD_LABEL: Record<KbAnalyticsPeriod, string> = {
  day: "за сутки",
  week: "за неделю",
  month: "за месяц",
};

/**
 * Sprint D / Phase 1 — Admin-dashboard аналитики времени на странице.
 *
 * Доступ: `kb.view_analytics` (миграция 077). Без permission'а
 * server-side redirect на /knowledge — RLS на kb_page_view_sessions
 * вернёт пустые наборы, а пустой dashboard под сотрудником без права
 * = security through obscurity, что плохо.
 *
 * Period selector — через `?p=day|week|month` query-param. Smake URL
 * shareable («дашборд за месяц» можно отправить ссылкой).
 *
 * Per-page drill-down (юзеры, читавшие конкретную страницу со временем)
 * пока не реализован — будет в следующей итерации Phase 1.3.5 как
 * `/knowledge/analytics/[slug]`. На MVP — клик по строке топ-страниц
 * ведёт на саму страницу.
 */
export default async function KbAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const period: KbAnalyticsPeriod = VALID_PERIODS.includes(
    p as KbAnalyticsPeriod,
  )
    ? (p as KbAnalyticsPeriod)
    : "week";

  const supabase = await createClient();
  const { data: canView } = await supabase.rpc("has_permission", {
    permission_code: "kb.view_analytics",
  });
  if (!canView) redirect("/knowledge");

  // Параллельно — два запроса не зависят друг от друга.
  const [{ rows: topPages, error: pagesError }, { rows: topUsers, error: usersError }] =
    await Promise.all([
      getKbAnalyticsTopPages({ period, limit: 10 }),
      getKbAnalyticsTopUsers({ period, limit: 10 }),
    ]);

  return (
    <div className="flex-1 flex flex-col">
      <PageBreadcrumb>
        <span className="text-sm font-medium text-foreground inline-flex items-center gap-2">
          <BarChart3 className="size-4 text-muted-foreground" />
          Аналитика
        </span>
      </PageBreadcrumb>

      <div className="px-6 md:px-8 pt-6 pb-8 w-full flex flex-col gap-6">
        <div className="mx-auto w-full max-w-[920px] flex flex-col gap-6">
          <header className="flex flex-col gap-3">
            <h1 className="text-[28px] font-extrabold tracking-tight">
              Аналитика базы знаний
            </h1>
            <p className="text-sm text-muted-foreground">
              Сколько времени сотрудники проводят на страницах. Учитывается
              активное время — без учёта неактивных вкладок и idle-периодов
            </p>
            <div>
              <KbAnalyticsPeriodTabs
                current={period}
                basePath="/knowledge/analytics"
              />
            </div>
          </header>

          {(pagesError || usersError) && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              Не удалось загрузить аналитику: {pagesError ?? usersError}
            </div>
          )}

          <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                Самые читаемые страницы
              </h2>
              <span className="text-xs text-muted-foreground">
                {PERIOD_LABEL[period]} · топ-{Math.min(topPages.length, 10) || 10}
              </span>
            </div>
            <KbAnalyticsTopPages rows={topPages} period={period} />
          </section>

          <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                Самые активные сотрудники
              </h2>
              <span className="text-xs text-muted-foreground">
                {PERIOD_LABEL[period]} · топ-{Math.min(topUsers.length, 10) || 10}
              </span>
            </div>
            <KbAnalyticsTopUsers rows={topUsers} />
          </section>
        </div>
      </div>
    </div>
  );
}
