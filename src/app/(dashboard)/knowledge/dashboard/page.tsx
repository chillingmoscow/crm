import Link from "next/link";
import { redirect } from "next/navigation";
import { LayoutDashboard } from "lucide-react";

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
import { listKbAuditEvents } from "@/lib/knowledge/audit";
import { KbAnalyticsPeriodTabs } from "@/app/(dashboard)/knowledge/analytics/_components/kb-analytics-period-tabs";
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
 * Дашборд менеджера базы знаний (sheerly `TvInj`).
 *
 * Сводит must-read покрытие, активность чтения и последние
 * изменения в один экран. Доступ: `kb.view_analytics` ∨
 * `org.view_audit` (иначе redirect /knowledge — пустой дашборд под
 * сотрудником без права = security through obscurity).
 *
 * Часть метрик питается analytics-RLS (`kb.view_analytics`); под
 * чистым `org.view_audit` они вернут пусто/«—», но лента изменений
 * (audit) останется — это нормально, дашборд деградирует мягко.
 */
export default async function KbManagerDashboardPage({
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
  const [{ data: canAnalytics }, { data: canAudit }] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "kb.view_analytics" }),
    supabase.rpc("has_permission", { permission_code: "org.view_audit" }),
  ]);
  if (!canAnalytics && !canAudit) redirect("/knowledge");

  const sinceISO = new Date(
    Date.now() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [
    { summary },
    { coverage },
    { rows: topPages },
    { rows: topUsers },
    { events: recentEvents },
    changesCountRes,
  ] = await Promise.all([
    getKbAnalyticsSummary({ period }),
    getKbRequiredReadingCoverage(),
    getKbAnalyticsTopPages({ period, limit: 5 }),
    getKbAnalyticsTopUsers({ period, limit: 3 }),
    listKbAuditEvents(),
    supabase
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "kb_page")
      .gte("created_at", sinceISO),
  ]);

  const coverageKnown =
    coverage.requiredPages > 0 && coverage.teamSize > 0;
  const pending = coverage.teamSize - coverage.done;
  const changesInPeriod = changesCountRes.count ?? 0;
  const latestChanges = recentEvents.slice(0, 6);

  return (
    <div className="flex-1 flex flex-col">
      <PageBreadcrumb>
        <span className="text-sm font-medium text-foreground inline-flex items-center gap-2">
          <LayoutDashboard className="size-4 text-muted-foreground" />
          Дашборд
        </span>
      </PageBreadcrumb>

      <div className="px-6 md:px-8 pt-6 pb-8 w-full flex flex-col gap-6">
        <div className="mx-auto w-full max-w-[1100px] flex flex-col gap-6">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-2 min-w-0">
              <h1 className="text-[28px] font-extrabold tracking-tight">
                Дашборд менеджера
              </h1>
              <p className="text-sm text-muted-foreground max-w-[640px]">
                Активность команды, обязательное чтение и быстрый
                доступ к журналу и корзине
              </p>
            </div>
            <KbAnalyticsPeriodTabs
              current={period}
              basePath="/knowledge/dashboard"
            />
          </header>

          {/* KPI-сводка */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
              label="Изменений"
              value={changesInPeriod}
              hint={PERIOD_LABEL[period]}
            />
          </div>

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

            <div className="flex flex-col gap-4">
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
                  <KbAnalyticsTopUsers rows={topUsers} />
                </div>
              </section>

              <section className="flex flex-col rounded-xl border bg-card overflow-hidden">
                <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3.5">
                  <h2 className="text-sm font-semibold text-foreground">
                    Последние изменения
                  </h2>
                  <Link
                    href="/knowledge/audit"
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Весь журнал →
                  </Link>
                </div>
                {latestChanges.length === 0 ? (
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

function waitWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "ждут";
  if (mod10 === 1) return "ждёт";
  if (mod10 >= 2 && mod10 <= 4) return "ждут";
  return "ждут";
}
