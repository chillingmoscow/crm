import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, AlertTriangle, Star, Clock, Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

import { getCachedPermissions } from "@/lib/supabase/server";
import { listRecentKbPages } from "@/lib/knowledge/pages";
import { listMyKbFavorites } from "@/lib/knowledge/favorites";
import {
  getKbRequiredUnreadForUser,
  getMyRecentlyViewedKbPages,
} from "@/lib/knowledge/landing";
import { EmptyState } from "@/components/ui/empty-state";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { CreateRootPageButton } from "@/app/(dashboard)/knowledge/_components/create-root-page-button";
import { KbSearchTrigger } from "@/app/(dashboard)/knowledge/_components/kb-search-dialog";
import { KbLandingSection } from "@/app/(dashboard)/knowledge/_components/kb-landing-section";

/**
 * KB landing — Sprint D Phase 6 redesign.
 *
 * Notion-style набор виджетов:
 *   1. Header + prominent search trigger (Cmd+K)
 *   2. «Требуется прочесть» — required_reading=true ∧ моя read_at IS NULL.
 *      Показывается ТОЛЬКО если есть unread (compliance-сигнал, отвлекать
 *      на пустую секцию не нужно).
 *   3. «Избранное» — kb_user_favorites.
 *   4. «Мои недавние» — из kb_page_view_sessions через
 *      kb_get_my_recently_viewed RPC (миграция 085). Self-view, без
 *      time/sessions данных — навигация-helper, не аналитика.
 *   5. «Недавние изменения в команде» — listRecentKbPages (был
 *      основным content'ом старого landing'а; теперь fallback secondary).
 *
 * Conditional render: каждая из (2)/(3)/(4) скрывается при пустом
 * списке. (5) — fallback empty-state если вообще ничего нет.
 *
 * Padding 16/32 совпадает с Sheerly `page` frame (sheerly.pen) — те
 * же токены что в существующих strana role/staff-list.
 */
export default async function KnowledgeLandingPage() {
  const perms = new Set(await getCachedPermissions());
  // Пользователь с доступом к аналитике заходит в «Базу знаний»
  // сразу на дашборд (его рабочая домашняя), а не на landing.
  if (perms.has("kb.view_analytics")) redirect("/knowledge/dashboard");
  // Кнопку «Новая страница» показываем только при праве создания —
  // иначе сотрудник жмёт и ловит RLS «new row violates ... kb_pages».
  const canCreate = perms.has("kb.create_pages");

  // Все 4 запроса параллельно — данные независимы.
  const [
    { rows: recentTeam },
    { pages: favorites },
    { rows: requiredUnread },
    { rows: recentlyViewed },
  ] = await Promise.all([
    listRecentKbPages(10),
    listMyKbFavorites(),
    getKbRequiredUnreadForUser(),
    getMyRecentlyViewedKbPages(7),
  ]);

  const isAllEmpty =
    recentTeam.length === 0 &&
    favorites.length === 0 &&
    requiredUnread.length === 0 &&
    recentlyViewed.length === 0;

  return (
    <div className="px-6 md:px-8 pt-4 pb-8 w-full flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5 min-w-0">
            <h1 className="text-[28px] font-bold tracking-tight leading-tight">
              База знаний
            </h1>
            <p className="text-sm text-muted-foreground">
              SOP, регламенты, рецепты, онбординг и внутренние материалы команды
            </p>
          </div>
          {canCreate && <CreateRootPageButton />}
        </div>
        {/* Prominent search bar — основной entry-point после landing'а.
            Cmd+K глобальный shortcut уже подвязан в KbSearchProvider. */}
        <KbSearchTrigger />
      </header>

      {isAllEmpty ? (
        <KbEmptyState canCreate={canCreate} />
      ) : (
        <div className="flex flex-col gap-6">
          <KbLandingSection
            title="Требуется прочесть"
            leadingIcon={
              <AlertTriangle className="size-3 text-yellow-700 dark:text-yellow-400" />
            }
            rows={requiredUnread}
          />
          <KbLandingSection
            title="Избранное"
            leadingIcon={
              <Star className="size-3 text-amber-500 fill-amber-400" />
            }
            rows={favorites}
          />
          <KbLandingSection
            title="Мои недавние"
            leadingIcon={<Clock className="size-3" />}
            rows={recentlyViewed}
            rowTrailing={(row) => {
              const ts = (row as (typeof recentlyViewed)[number]).last_visit_at;
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
          <section className="flex flex-col gap-2">
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70 inline-flex items-center gap-1.5 px-1">
              <Activity className="size-3" />
              Недавние изменения в команде
            </h2>
            {recentTeam.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2 px-3">
                Команда пока ничего не редактировала.
              </p>
            ) : (
              <RecentTeamList rows={recentTeam} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function KbEmptyState({ canCreate }: { canCreate: boolean }) {
  return (
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
  );
}

function RecentTeamList({
  rows,
}: {
  rows: Array<{
    id: string;
    slug: string;
    title: string;
    icon: string | null;
    icon_color: string | null;
    updated_at: string | null;
    created_at: string;
  }>;
}) {
  return (
    <ul className="flex flex-col gap-px">
      {rows.map((row) => {
        const ts = row.updated_at ?? row.created_at;
        return (
          <li key={row.id}>
            <Link
              href={`/knowledge/${row.slug}`}
              className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent transition-colors"
            >
              <KbPageIcon icon={row.icon} color={row.icon_color} size={18} />
              <span className="flex-1 truncate text-sm font-medium">
                {row.title || "Без названия"}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {formatDistanceToNow(new Date(ts), {
                  addSuffix: true,
                  locale: ru,
                })}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
