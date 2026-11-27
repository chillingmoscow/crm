import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, BookMarked, BookOpen, Clock, Star } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

import {
  createClient,
  getCachedPermissions,
} from "@/lib/supabase/server";
import { listRecentKbPages } from "@/lib/knowledge/pages";
import { listMyKbFavorites } from "@/lib/knowledge/favorites";
import {
  getKbRequiredUnreadForUser,
  getMyRecentlyViewedKbPages,
} from "@/lib/knowledge/landing";
import { EmptyState } from "@/components/ui/empty-state";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageFrame } from "@/components/shared/page-frame";
import { TablePageHeader } from "@/components/shared/table/table-page-header";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { CreateRootPageButton } from "@/app/(dashboard)/knowledge/_components/create-root-page-button";
import { KbLandingSection } from "@/app/(dashboard)/knowledge/_components/kb-landing-section";

/**
 * Главная базы знаний: обязательное чтение с прогрессом (`#to-read` — на
 * него ведёт пункт «К прочтению» в дереве), «Недавно обновлённые», «Мои
 * недавние», «Избранное». Открыта всем; менеджера с правом аналитики
 * значок «База знаний» в меню ведёт сразу на «Обзор» (KbNavLink), а сюда —
 * пункт «Главная» дерева. Кнопка «Новая страница» — только при
 * `kb.create_pages`.
 *
 * Все блоки conditional: пустые секции скрываются. Полностью пусто
 * → empty-state (с поправкой на права создания).
 */
export const metadata: Metadata = { title: "База знаний" };

export default async function KnowledgeLandingPage() {
  const perms = new Set(await getCachedPermissions());
  const canCreate = perms.has("kb.create_pages");

  const supabase = await createClient();
  const [
    { rows: recentTeam },
    { pages: favorites },
    { rows: requiredUnread },
    { rows: recentlyViewed },
    requiredCountRes,
  ] = await Promise.all([
    listRecentKbPages(8),
    listMyKbFavorites(),
    getKbRequiredUnreadForUser(),
    getMyRecentlyViewedKbPages(7),
    supabase
      .from("kb_pages")
      .select("id", { count: "exact", head: true })
      .eq("required_reading", true)
      .is("deleted_at", null),
  ]);

  const requiredTotal = requiredCountRes.count ?? 0;
  const readCount = Math.max(0, requiredTotal - requiredUnread.length);
  const progressPct =
    requiredTotal > 0 ? Math.round((readCount / requiredTotal) * 100) : 0;

  const isAllEmpty =
    recentTeam.length === 0 &&
    favorites.length === 0 &&
    requiredUnread.length === 0 &&
    recentlyViewed.length === 0 &&
    requiredTotal === 0;

  return (
    <PageFrame className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: "База знаний" }]} />
      <TablePageHeader
        title="База знаний"
        actions={canCreate ? <CreateRootPageButton /> : undefined}
      />

      {isAllEmpty ? (
        <EmptyState
          icon={BookOpen}
          title="Здесь пока нет страниц"
          description={
            canCreate
              ? "Создайте первую страницу — например, регламент бара или чек-лист открытия смены."
              : "Пока здесь пусто. Когда коллеги добавят регламенты и материалы, они появятся тут."
          }
          action={canCreate ? <CreateRootPageButton /> : undefined}
        />
      ) : (
        <div className="flex flex-col gap-7">
          {/* Hero обязательного чтения — только если есть обязательные. */}
          {requiredTotal > 0 && (
            <section
              id="to-read"
              className="flex scroll-mt-6 flex-col gap-4 rounded-xl border border-brand/20 bg-brand/5 p-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="inline-flex items-center gap-2 text-base font-semibold text-foreground">
                  <BookMarked className="size-4 text-brand" />
                  Обязательное чтение
                </h2>
                <span className="rounded-full border border-brand/30 bg-background px-3 py-1 text-xs font-semibold text-brand tabular-nums">
                  {readCount} из {requiredTotal} прочитано
                </span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-brand/15"
                role="progressbar"
                aria-valuenow={progressPct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="chart-bar-grow-x h-full rounded-full bg-brand"
                  style={{ width: `${progressPct}%`, animationDelay: "200ms" }}
                />
              </div>
              {requiredUnread.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {requiredUnread.slice(0, 4).map((row) => (
                    <li key={row.id}>
                      <Link
                        href={`/knowledge/${row.slug}`}
                        className="group/title flex items-center gap-3 rounded-lg border border-brand/20 bg-background px-4 py-3 transition-colors hover:border-brand/40"
                      >
                        <KbPageIcon
                          icon={row.icon}
                          color={row.icon_color}
                          size={18}
                        />
                        <span className="flex-1 truncate text-sm font-medium transition-colors duration-200 group-hover/title:text-brand">
                          {row.title || "Без названия"}
                        </span>
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Всё обязательное прочитано — спасибо!
                </p>
              )}
            </section>
          )}

          {/* Недавно обновлённые — сетка карточек. */}
          {recentTeam.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70 px-1">
                Недавно обновлённые
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {recentTeam.map((row) => {
                  const ts = row.updated_at ?? row.created_at;
                  return (
                    <Link
                      key={row.id}
                      href={`/knowledge/${row.slug}`}
                      className="group/title flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-accent/40"
                    >
                      <KbPageIcon
                        icon={row.icon}
                        color={row.icon_color}
                        size={22}
                      />
                      <span className="line-clamp-2 text-sm font-medium leading-snug transition-colors duration-200 group-hover/title:text-brand">
                        {row.title || "Без названия"}
                      </span>
                      <span className="mt-auto text-xs text-muted-foreground tabular-nums">
                        {formatDistanceToNow(new Date(ts), {
                          addSuffix: true,
                          locale: ru,
                        })}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {/* Мои недавние + Избранное. */}
          {(recentlyViewed.length > 0 || favorites.length > 0) && (
            <div className="grid gap-6 lg:grid-cols-2">
              <KbLandingSection
                title="Мои недавние"
                leadingIcon={<Clock className="size-3" />}
                rows={recentlyViewed}
                rowTrailing={(row) => {
                  const ts = (row as (typeof recentlyViewed)[number])
                    .last_visit_at;
                  if (!ts) return null;
                  return (
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {formatDistanceToNow(new Date(ts), {
                        addSuffix: true,
                        locale: ru,
                      })}
                    </span>
                  );
                }}
              />
              <KbLandingSection
                title="Избранное"
                leadingIcon={
                  <Star className="size-3 text-amber-500 fill-amber-400" />
                }
                rows={favorites}
              />
            </div>
          )}
        </div>
      )}
    </PageFrame>
  );
}
