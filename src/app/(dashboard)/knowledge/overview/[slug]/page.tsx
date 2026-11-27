import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Users } from "lucide-react";

import { getCachedPermissionChecker } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { EmployeeIdentity } from "@/components/shared/employee-identity";
import { Metric, MetricStrip } from "@/components/shared/metric-strip";
import { ProfilePageFrame } from "@/components/shared/page-frame";
import { TablePageHeader } from "@/components/shared/table/table-page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { KbOverviewPeriod } from "../_components/kb-overview-period";
import { getKbPageBySlugCached } from "@/lib/knowledge/page-by-slug";
import { getKbAnalyticsPageViewers } from "@/lib/knowledge/analytics";
import {
  kbOverviewPeriodLabel,
  kbOverviewPeriodQuery,
  kbOverviewWindow,
  parseKbOverviewPeriod,
} from "@/lib/knowledge/overview";
import { countRu } from "@/lib/format/plural";
import { formatDayMonth } from "@/lib/format/date";
import { getActiveAccountTimezone } from "@/lib/settings/account";

/**
 * Статистика одной страницы: кто и сколько её читал за период (неделя или
 * месяц, как в «Обзоре»). Право `kb.view_analytics`; ссылка — из ⓘ
 * документа и из «Обзора».
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { row } = await getKbPageBySlugCached(slug);
  return { title: `Статистика «${row?.title?.trim() || "Без названия"}»` };
}

function minutes(seconds: number): string {
  const min = Math.round(seconds / 60);
  return min < 1 ? "меньше минуты" : `${min} мин`;
}

export default async function KbPageStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ period?: string; from?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;

  const can = await getCachedPermissionChecker();
  if (!can("kb.view_analytics")) redirect("/knowledge");

  const { row: page, error: pageError } = await getKbPageBySlugCached(slug);
  if (pageError || !page) notFound();

  const timeZone = await getActiveAccountTimezone();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  const period = parseKbOverviewPeriod(query, today);
  const { rows: viewers, error } = await getKbAnalyticsPageViewers({
    pageId: page.id,
    window: kbOverviewWindow(period),
  });
  const title = page.title?.trim() || "Без названия";
  const totalSeconds = viewers.reduce((sum, v) => sum + v.total_seconds, 0);
  const visits = viewers.reduce((sum, v) => sum + v.session_count, 0);

  return (
    <ProfilePageFrame>
      <Breadcrumbs
        items={[
          { label: "База знаний", href: "/knowledge" },
          { label: "Обзор", href: `/knowledge/overview?${kbOverviewPeriodQuery(period)}` },
          { label: title },
        ]}
      />
      <TablePageHeader
        title="Статистика страницы"
        period={<KbOverviewPeriod period={period} today={today} />}
      />

      <Link
        href={`/knowledge/${page.slug}`}
        className="flex min-w-0 items-center gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-foreground/20"
      >
        <KbPageIcon icon={page.icon} color={page.icon_color} size={20} />
        <span className="truncate text-base font-semibold">{title}</span>
      </Link>

      <MetricStrip label={`Чтение за период: ${kbOverviewPeriodLabel(period)}`}>
        <Metric primary label="Читателей" value={viewers.length} />
        <Metric label="Время чтения" value={totalSeconds > 0 ? minutes(totalSeconds) : "—"} />
        <Metric label="Визитов" value={visits} />
      </MetricStrip>

      {error ? (
        <EmptyState illustration="error" title="Не удалось загрузить статистику" description="Обновите страницу позже." />
      ) : viewers.length === 0 ? (
        <EmptyState icon={Users} title="За этот период страницу не читали" />
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {viewers.map((v) => (
            <li key={v.user_id} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <EmployeeIdentity name={v.name} avatarUrl={v.avatar_url} role={countRu(v.session_count, "визит", "визита", "визитов")} />
              </span>
              <span className="text-right">
                <span className="block text-sm font-medium tabular-nums">{minutes(v.total_seconds)}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatDayMonth(v.last_visit_at, new Date(), timeZone)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </ProfilePageFrame>
  );
}
