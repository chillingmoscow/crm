import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, Clock, BookCheck } from "lucide-react";

import { getCachedPermissionChecker } from "@/lib/supabase/server";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { getKbPageBySlug } from "@/lib/knowledge/pages";
import {
  getKbRequiredReadingStats,
  type KbRequiredReadingStatsRow,
} from "@/lib/knowledge/required-reading";

/**
 * Sprint D / Phase 2 — Admin view «кто прочитал, кто нет».
 *
 * Доступ: `kb.manage_required_reading` (миграция 075). Без permission'а
 * redirect на саму страницу — защита от любопытных hostess'ов.
 *
 * Список разделён на две секции:
 *   — Прочитали — кто подтвердил (сортировка по read_at desc).
 *   — Не прочитали — pool members active account, кто ещё не подтвердил
 *     (алфавитно). Pool — все active user_venue_role в venue'ах account'а
 *     (= pool @-mention picker'а из миграции 061; единый источник истины
 *     «кто живёт в этом аккаунте»).
 *
 * Pool «должны прочитать» намеренно широкий: required-reading в MVP =
 * «обязательно для всех в аккаунте». Per-role или per-user assignment
 * (Раздел 2.7-D) — отдельная фича вместе с per-page sharing.
 */
export default async function KbRequiredReadingAdminPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const can = await getCachedPermissionChecker();
  if (!can("kb.manage_required_reading")) redirect(`/knowledge/${slug}`);

  const { row: page, error: pageError } = await getKbPageBySlug(slug);
  if (pageError || !page) notFound();

  const { rows, error } = await getKbRequiredReadingStats(page.id);

  const readRows = rows.filter((r) => r.read_at !== null);
  const unreadRows = rows.filter((r) => r.read_at === null);
  const total = rows.length;
  const readPct = total > 0 ? Math.round((readRows.length / total) * 100) : 0;

  return (
    <div className="flex-1 flex flex-col">
      <PageBreadcrumb>
        <span className="text-sm font-medium text-foreground inline-flex items-center gap-2">
          <BookCheck className="size-4 text-muted-foreground" />
          Кто прочитал
        </span>
      </PageBreadcrumb>

      <div className="px-6 md:px-8 pt-6 pb-8 w-full flex flex-col gap-6">
        <div className="mx-auto w-full max-w-[760px] flex flex-col gap-6">
          <Link
            href={`/knowledge/${page.slug}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground self-start"
          >
            <ArrowLeft className="size-4" />К странице
          </Link>

          <header className="flex items-start gap-3">
            <KbPageIcon icon={page.icon} color={page.icon_color} size={28} />
            <div className="flex flex-col gap-1.5 min-w-0">
              <h1 className="text-[24px] font-bold tracking-tight leading-tight">
                {page.title || "Без названия"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {page.required_reading
                  ? `Обязательная к прочтению. Прочитали ${readRows.length} из ${total} (${readPct}%).`
                  : `Страница не помечена как обязательная. Записи о прочтении сохранены за прошлые периоды.`}
              </p>
            </div>
          </header>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              Не удалось загрузить статистику: {error}
            </div>
          )}

          <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-foreground inline-flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                Прочитали
              </h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                {readRows.length}
              </span>
            </div>
            <ReaderList rows={readRows} mode="read" />
          </section>

          <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-foreground inline-flex items-center gap-2">
                <Clock className="size-4 text-amber-600 dark:text-amber-400" />
                Не прочитали
              </h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                {unreadRows.length}
              </span>
            </div>
            <ReaderList rows={unreadRows} mode="unread" />
          </section>
        </div>
      </div>
    </div>
  );
}

function ReaderList({
  rows,
  mode,
}: {
  rows: KbRequiredReadingStatsRow[];
  mode: "read" | "unread";
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 px-2">
        {mode === "read"
          ? "Никто пока не подтвердил прочтение."
          : "Все members подтвердили прочтение 🎉"}
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
          {mode === "read" && row.read_at && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatRelative(row.read_at)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${plural(days, "день", "дня", "дней")} назад`;
  const months = Math.floor(days / 30);
  return `${months} ${plural(months, "месяц", "месяца", "месяцев")} назад`;
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
