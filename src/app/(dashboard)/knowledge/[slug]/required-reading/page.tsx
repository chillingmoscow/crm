import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Users } from "lucide-react";

import { getCachedPermissionChecker } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { EmployeeIdentity } from "@/components/shared/employee-identity";
import { ProfilePageFrame } from "@/components/shared/page-frame";
import { TablePageHeader } from "@/components/shared/table/table-page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { KbReadingActions } from "@/app/(dashboard)/knowledge/_components/kb-reading-actions";
import { getKbPageBySlugCached } from "@/lib/knowledge/page-by-slug";
import {
  getKbRequiredReadingOverview,
  getKbRequiredReadingStats,
  type KbRequiredReadingStatsRow,
} from "@/lib/knowledge/required-reading";
import type { KbReadingStatus } from "@/lib/knowledge/reading-state";
import { formatDayMonth } from "@/lib/format/date";
import { getActiveAccountTimezone } from "@/lib/settings/account";

/**
 * «Кто прочитал» обязательную страницу — для руководителя с
 * `kb.manage_required_reading`; без права — обратно на страницу.
 * Состав — активные, не уволенные сотрудники аккаунта с доступом к базе
 * знаний (kb_required_reading_roster, миграция 416). Сначала те, кто ещё
 * не прочитал, потом кого попросили перечитать, внизу прочитавшие.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { row } = await getKbPageBySlugCached(slug);
  return { title: `Кто прочитал — ${row?.title?.trim() || "Без названия"}` };
}

const STATUS_ORDER: Record<KbReadingStatus, number> = { unread: 0, reread: 1, read: 2 };

const STATUS_TONE: Record<KbReadingStatus, StatusTone> = {
  unread: "neutral",
  reread: "warning",
  read: "success",
};

function statusLabel(row: KbRequiredReadingStatsRow, timeZone: string): string {
  if (row.status === "unread") return "Не прочитал";
  if (row.status === "reread") return "Нужно перечитать";
  const day = formatDayMonth(row.read_at, new Date(), timeZone);
  return day ? `Прочитал ${day}` : "Прочитал";
}

export default async function KbRequiredReadingAdminPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const can = await getCachedPermissionChecker();
  if (!can("kb.manage_required_reading")) redirect(`/knowledge/${slug}`);

  const { row: page, error: pageError } = await getKbPageBySlugCached(slug);
  if (pageError || !page) notFound();

  const [{ rows, error }, [summary], timeZone] = await Promise.all([
    getKbRequiredReadingStats(page.id),
    getKbRequiredReadingOverview(page.id),
    getActiveAccountTimezone(),
  ]);

  const sorted = [...rows].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (b.read_at ?? "").localeCompare(a.read_at ?? "") ||
      a.name.localeCompare(b.name, "ru"),
  );
  const readCount = rows.filter((r) => r.status === "read").length;
  const title = page.title?.trim() || "Без названия";

  return (
    <ProfilePageFrame>
      <Breadcrumbs
        items={[
          { label: "База знаний", href: "/knowledge" },
          { label: title, href: `/knowledge/${page.slug}` },
          { label: "Кто прочитал" },
        ]}
      />

      <TablePageHeader title="Кто прочитал" />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border bg-card p-4">
        <KbPageIcon icon={page.icon} color={page.icon_color} size={20} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Link
            href={`/knowledge/${page.slug}`}
            className="truncate text-base font-semibold transition-colors hover:text-brand"
          >
            {title}
          </Link>
          <span className="text-[13px] tabular-nums text-muted-foreground">
            {page.required_reading
              ? `Прочитали ${readCount} из ${rows.length}`
              : "Не обязательна к прочтению. Отметки о прочтении сохранены."}
          </span>
        </div>
        {page.required_reading && summary && (
          <KbReadingActions
            pageId={page.id}
            title={title}
            remindCount={summary.remindCount}
            staleCount={summary.staleCount}
            changedAfterRead={summary.changedAfterRead}
            remindedAt={summary.remindedAt}
          />
        )}
      </div>

      {error ? (
        <EmptyState
          illustration="error"
          title="Не удалось загрузить список"
          description="Обновите страницу или попробуйте позже."
        />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Читать пока некому"
          description="Здесь появятся сотрудники с доступом к базе знаний."
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border bg-card">
          {sorted.map((row) => (
            <li key={row.user_id} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <EmployeeIdentity name={row.name} role={row.roleName} avatarUrl={row.avatar_url} />
              </span>
              <StatusBadge tone={STATUS_TONE[row.status]}>{statusLabel(row, timeZone)}</StatusBadge>
            </li>
          ))}
        </ul>
      )}
    </ProfilePageFrame>
  );
}
