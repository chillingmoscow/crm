import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuditEventRow } from "@/components/audit/audit-event-row";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { Metric, MetricStrip } from "@/components/shared/metric-strip";
import { PageFrame } from "@/components/shared/page-frame";
import { SalesTrend, type TrendSeries } from "@/components/shared/sales-trend";
import { TablePageHeader } from "@/components/shared/table/table-page-header";
import { HomeSection, SectionLink } from "@/app/(dashboard)/dashboard/_components/section";
import { KbReindexAiButton } from "@/app/(dashboard)/knowledge/_components/kb-reindex-ai-button";
import { KbOverviewAttention, KbOverviewPopular } from "./_components/kb-overview-blocks";
import { KbOverviewPagesTable, type KbOverviewPageRow } from "./_components/kb-overview-pages-table";
import { KbOverviewPeriod } from "./_components/kb-overview-period";
import { KbOverviewViewTabs } from "./_components/kb-overview-view-tabs";
import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissions,
} from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { LooseQuery } from "@/lib/supabase/loose";
import { listAuditEvents } from "@/lib/audit/list";
import {
  getKbAnalyticsSummary,
  getKbAnalyticsTopPages,
  getKbMonthlyTrend,
} from "@/lib/knowledge/analytics";
import {
  kbOverviewBlocks,
  kbOverviewPeriodLabel,
  kbOverviewStaleBefore,
  kbOverviewWindow,
  parseKbOverviewPeriod,
  shiftKbOverviewPeriod,
} from "@/lib/knowledge/overview";
import { getKbRequiredReadingOverview } from "@/lib/knowledge/required-reading";
import { canOpenKbOverview } from "@/lib/knowledge/shell";
import { countRu } from "@/lib/format/plural";
import { getActiveAccountTimezone } from "@/lib/settings/account";

/**
 * «Обзор» базы знаний (бывший «Дашборд», спека «Обзор»). Открывается при
 * любом из прав аналитики, обязательного чтения или журнала; каждый блок —
 * при своём праве (`kbOverviewBlocks`). Период — неделя или месяц в адресе,
 * вид «По страницам» — `?view=pages`.
 */
export const metadata: Metadata = { title: "Обзор базы знаний" };

type PageListRow = {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  icon_color: string | null;
  updated_at: string | null;
  created_at: string;
};

function minutesLabel(seconds: number): string {
  if (seconds <= 0) return "0 мин";
  const min = Math.round(seconds / 60);
  return min < 1 ? "меньше минуты" : `${min.toLocaleString("ru-RU")} мин`;
}

/** «+12 % к прошлой неделе», «как на прошлой неделе». */
function compareHint(now: number, before: number, kind: "week" | "month"): string {
  const base = kind === "week" ? "к прошлой неделе" : "к прошлому месяцу";
  if (before <= 0) return now > 0 ? "в прошлом периоде чтения не было" : "чтения не было";
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return kind === "week" ? "как на прошлой неделе" : "как в прошлом месяце";
  return `${change > 0 ? "+" : "−"}${Math.abs(change)} % ${base}`;
}

export default async function KbOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; view?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const perms = new Set(await getCachedPermissions());
  if (!canOpenKbOverview(perms)) redirect("/knowledge");
  const blocks = kbOverviewBlocks(perms);

  const timeZone = await getActiveAccountTimezone();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  const period = parseKbOverviewPeriod(params, today);
  const window = kbOverviewWindow(period);
  const previous = kbOverviewWindow(shiftKbOverviewPeriod(period, -1));
  const view = blocks.pagesView && params.view === "pages" ? "pages" : "overview";
  const needPages = view === "pages" || blocks.attention;

  const supabase = await createClient();
  const accountId = await getCachedActiveAccountId();

  const [summary, previousSummary, reading, pages, topPages, trend, audit, aiEnabled] = await Promise.all([
    blocks.metrics ? getKbAnalyticsSummary({ window }) : null,
    blocks.metrics ? getKbAnalyticsSummary({ window: previous }) : null,
    blocks.attention ? getKbRequiredReadingOverview() : Promise.resolve([]),
    needPages
      ? fetchAllRows<PageListRow>(
          () =>
            supabase
              .from("kb_pages")
              .select("id, slug, title, icon, icon_color, updated_at, created_at")
              .is("deleted_at", null) as unknown as LooseQuery<PageListRow[]>,
        ).catch((error: Error) => {
          console.error("[kb] обзор: список страниц:", error.message);
          return [] as PageListRow[];
        })
      : Promise.resolve([] as PageListRow[]),
    blocks.popular || view === "pages"
      ? getKbAnalyticsTopPages({ window, limit: view === "pages" ? undefined : 5 })
      : null,
    blocks.trend && view === "overview" ? getKbMonthlyTrend({ months: 12 }) : null,
    blocks.changes
      ? Promise.all([
          listAuditEvents({ entityType: "kb_page", pageSize: 6 }),
          supabase
            .from("audit_logs")
            .select("id", { count: "exact", head: true })
            .eq("entity_type", "kb_page")
            .gte("created_at", window.sinceISO)
            .lt("created_at", window.untilISO),
        ])
      : null,
    perms.has("kb.ask_ai") && perms.has("kb.create_pages") && accountId
      ? supabase
          .from("accounts")
          .select("ai_enabled")
          .eq("id", accountId as unknown as string)
          .maybeSingle()
          .then(({ data }) => Boolean(data?.ai_enabled))
      : false,
  ]);

  const staleBefore = kbOverviewStaleBefore(today);
  const staleCount = pages.filter((p) => (p.updated_at ?? p.created_at) < staleBefore).length;

  const readNeeded = reading.reduce((sum, r) => sum + r.total, 0);
  const readDone = reading.reduce((sum, r) => sum + r.readCount, 0);
  const roster = reading[0]?.total ?? null;
  const changes = audit?.[1].count ?? null;
  const loadError = summary?.error ?? topPages?.error ?? trend?.error ?? audit?.[0].error ?? null;

  const trendRows = trend?.rows ?? [];
  const trendSeries: Record<string, TrendSeries> = {
    time: {
      label: "Время чтения",
      unit: "мин",
      points: trendRows.map((r) => ({ month: r.monthKey, value: Math.round(r.totalSeconds / 60) })),
    },
    views: {
      label: "Просмотры",
      unit: "просм.",
      points: trendRows.map((r) => ({
        month: r.monthKey,
        value: r.sessionCount,
        note: countRu(r.uniqueReaders, "читатель", "читателя", "читателей"),
      })),
    },
  };
  const trendMonthsWithData = trendRows.filter((r) => r.sessionCount > 0).length;

  const readingByPage = new Map(reading.map((r) => [r.pageId, r]));
  const statsByPage = new Map((topPages?.rows ?? []).map((r) => [r.page_id, r]));
  const pageRows: KbOverviewPageRow[] = pages.map((p) => {
    const stats = statsByPage.get(p.id);
    const required = readingByPage.get(p.id);
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      icon: p.icon,
      iconColor: p.icon_color,
      views: stats?.session_count ?? 0,
      seconds: stats?.total_seconds ?? 0,
      read: required ? { read: required.readCount, total: required.total } : null,
      updatedAt: p.updated_at ?? p.created_at,
    };
  });

  const showMetrics = blocks.metrics || blocks.attention || blocks.changes;

  return (
    <PageFrame className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: "База знаний", href: "/knowledge" }, { label: "Обзор" }]} />
      <TablePageHeader
        title="Обзор"
        period={<KbOverviewPeriod period={period} today={today} />}
        actions={aiEnabled ? <KbReindexAiButton /> : undefined}
      />

      {blocks.pagesView && <KbOverviewViewTabs view={view} />}

      {loadError && (
        <p role="status" className="text-sm text-muted-foreground">
          Часть данных не загрузилась. Обновите страницу позже.
        </p>
      )}

      {view === "pages" ? (
        <KbOverviewPagesTable
          rows={pageRows}
          timeZone={timeZone}
          sortUpdated={params.sort === "updated"}
          showRead={blocks.attention}
        />
      ) : (
        <>
          {showMetrics && (
            <MetricStrip label={`Показатели за период: ${kbOverviewPeriodLabel(period)}`}>
              {blocks.attention && (
                <Metric
                  primary
                  label="Обязательное прочитано"
                  value={readNeeded > 0 ? `${Math.round((readDone / readNeeded) * 100)} %` : "—"}
                  hint={
                    reading.length > 0
                      ? countRu(reading.length, "обязательная страница", "обязательные страницы", "обязательных страниц")
                      : "Обязательных страниц нет"
                  }
                />
              )}
              {blocks.metrics && (
                <Metric
                  label="Читали"
                  value={summary?.summary ? summary.summary.activeReaders : "—"}
                  hint={
                    summary?.summary
                      ? roster !== null
                        ? `из ${countRu(roster, "сотрудника", "сотрудников", "сотрудников")}`
                        : "сотрудников за период"
                      : "Нет данных"
                  }
                />
              )}
              {blocks.metrics && (
                <Metric
                  label="Время чтения"
                  value={summary?.summary ? minutesLabel(summary.summary.totalSeconds) : "—"}
                  hint={
                    summary?.summary && previousSummary?.summary
                      ? compareHint(summary.summary.totalSeconds, previousSummary.summary.totalSeconds, period.kind)
                      : "Нет данных"
                  }
                />
              )}
              {blocks.changes && (
                <Metric
                  label="Изменений"
                  value={changes ?? "—"}
                  hint={changes === null ? "Нет данных" : "правки, перемещения и удаления"}
                />
              )}
            </MetricStrip>
          )}

          {/* «Требует внимания» — на всю ширину: у строк по две кнопки, в
              половине экрана текст сжимался бы в столбик. */}
          {blocks.attention && <KbOverviewAttention reading={reading} staleCount={staleCount} />}

          {(blocks.popular || blocks.changes) && (
            <div className={blocks.popular && blocks.changes ? "grid items-start gap-6 lg:grid-cols-2" : "grid gap-6"}>
              {blocks.popular && <KbOverviewPopular rows={topPages?.rows ?? []} />}
              {blocks.changes && (
                <HomeSection
                  title="Последние изменения"
                  action={<SectionLink href="/org/audit?sections=kb" label="Весь журнал" />}
                >
                  {(audit?.[0].events.length ?? 0) === 0 ? (
                    <p className="py-2 text-sm text-muted-foreground">Изменений пока нет</p>
                  ) : (
                    <ul className="-mx-5 -mb-5 flex flex-col border-t">
                      {audit![0].events.map((event) => (
                        <AuditEventRow key={event.id} event={event} timeZone={timeZone} />
                      ))}
                    </ul>
                  )}
                </HomeSection>
              )}
            </div>
          )}

          {blocks.trend && trendMonthsWithData >= 3 && (
            <HomeSection title="По месяцам">
              <SalesTrend series={trendSeries} title="Чтение по месяцам" highlight={today.slice(0, 7)} />
            </HomeSection>
          )}
        </>
      )}
    </PageFrame>
  );
}
