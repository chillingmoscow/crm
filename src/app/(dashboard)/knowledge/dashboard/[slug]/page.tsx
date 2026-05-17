import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ChevronLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { getKbPageBySlug } from "@/lib/knowledge/pages";
import {
  getKbAnalyticsPageViewers,
  type KbAnalyticsPeriod,
} from "@/lib/knowledge/analytics";

const VALID_PERIODS: KbAnalyticsPeriod[] = ["day", "week", "month"];
const PERIOD_LABEL: Record<KbAnalyticsPeriod, string> = {
  day: "за сутки",
  week: "за неделю",
  month: "за месяц",
};

/**
 * Per-page drill-down — кто и сколько читал конкретную KB-страницу.
 * Доступ под `kb.view_analytics` (миграция 077). Раньше жил на
 * `/knowledge/analytics/[slug]`; после объединения Дашборда и
 * Аналитики переехал сюда (`/knowledge/analytics/*` 301-redirect'ится
 * в next.config). Slug в URL — для читаемости вместо UUID.
 */
export default async function KbDashboardPageDrilldown({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ p?: string }>;
}) {
  const { slug } = await params;
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

  const { row: page, error: pageError } = await getKbPageBySlug(slug);
  if (pageError || !page) notFound();

  const { rows: viewers, error: viewersError } =
    await getKbAnalyticsPageViewers({ pageId: page.id, period });

  return (
    <div className="flex-1 flex flex-col">
      <PageBreadcrumb>
        <Link
          href="/knowledge/dashboard"
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Дашборд
        </Link>
      </PageBreadcrumb>

      <div className="px-6 md:px-8 pt-4 pb-8 w-full">
        <div className="mx-auto w-full max-w-[1100px] flex flex-col gap-6">
          <Link
            href={`/knowledge/dashboard?p=${period}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground self-start"
          >
            <ArrowLeft className="size-4" />
            К дашборду
          </Link>

          <header className="flex items-start gap-3">
            <KbPageIcon icon={page.icon} color={page.icon_color} size={28} />
            <div className="flex flex-col gap-1.5 min-w-0">
              <h1 className="text-[28px] font-bold tracking-tight leading-tight">
                {page.title || "Без названия"}
              </h1>
              <p className="text-sm text-muted-foreground">
                Кто и сколько времени провёл на этой странице{" "}
                {PERIOD_LABEL[period]}.
              </p>
            </div>
          </header>

          {viewersError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              Не удалось загрузить аналитику: {viewersError}
            </div>
          )}

          <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-foreground">
                Читавшие
              </h2>
              <span className="text-xs text-muted-foreground">
                {viewers.length}{" "}
                {plural(viewers.length, "человек", "человека", "человек")}
              </span>
            </div>
            <ViewersList rows={viewers} />
          </section>

          <Link
            href={`/knowledge/${page.slug}`}
            className="text-sm text-muted-foreground hover:text-foreground self-start"
          >
            ← Открыть страницу
          </Link>
        </div>
      </div>
    </div>
  );
}

function ViewersList({
  rows,
}: {
  rows: Array<{
    user_id: string;
    name: string;
    avatar_url: string | null;
    total_seconds: number;
    session_count: number;
    last_visit_at: string;
  }>;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 px-2">
        За выбранный период страницу не открывали.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-px">
      {rows.map((row) => (
        <li
          key={row.user_id}
          className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent transition-colors"
        >
          <Avatar name={row.name} avatarUrl={row.avatar_url} />
          <span className="flex-1 truncate text-sm font-medium">
            {row.name}
          </span>
          <span className="hidden md:inline text-xs text-muted-foreground tabular-nums">
            {row.session_count} сессий · посл.{" "}
            {formatRelative(row.last_visit_at)}
          </span>
          <span className="w-20 text-right text-sm font-medium tabular-nums">
            {formatDuration(row.total_seconds)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}с`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}м`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin > 0 ? `${hours}ч ${remMin}м` : `${hours}ч`;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  const days = Math.floor(hours / 24);
  return `${days} ${plural(days, "день", "дня", "дней")}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function Avatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl: string | null;
}) {
  const initials =
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?";
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name}
        className="size-7 rounded-full object-cover bg-muted shrink-0"
      />
    );
  }
  return (
    <span className="size-7 rounded-full bg-muted text-muted-foreground inline-flex items-center justify-center text-xs font-semibold shrink-0">
      {initials}
    </span>
  );
}
