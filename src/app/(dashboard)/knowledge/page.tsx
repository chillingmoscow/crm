import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, BookMarked, BookOpen, Clock, Star } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

import {
  createClient,
  getCachedUser,
  getCachedPermissions,
} from "@/lib/supabase/server";
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
 * KB-главная для сотрудника (sheerly `foMCZ`): приветствие по имени,
 * hero обязательного чтения с прогрессом, «Недавно обновлённые»,
 * «Мои недавние», «Избранное».
 *
 * Role-aware: пользователь с `kb.view_analytics` сюда не попадает —
 * редиректится на свою рабочую домашнюю `/knowledge/dashboard`
 * (раздел «База знаний» для него = дашборд). Кнопка «Новая
 * страница» — только при `kb.create_pages` (иначе сотрудник ловил
 * RLS `new row violates ... kb_pages`).
 *
 * Все блоки conditional: пустые секции скрываются. Полностью пусто
 * → empty-state (с поправкой на права создания).
 */
export default async function KnowledgeLandingPage() {
  const perms = new Set(await getCachedPermissions());
  if (perms.has("kb.view_analytics")) redirect("/knowledge/dashboard");
  const canCreate = perms.has("kb.create_pages");

  const supabase = await createClient();
  const [
    user,
    { rows: recentTeam },
    { pages: favorites },
    { rows: requiredUnread },
    { rows: recentlyViewed },
    requiredCountRes,
  ] = await Promise.all([
    getCachedUser(),
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

  let firstName: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name")
      .eq("id", user.id)
      .maybeSingle();
    firstName = profile?.first_name?.trim() || null;
  }

  const requiredTotal = requiredCountRes.count ?? 0;
  const unreadCount = requiredUnread.length;
  const readCount = Math.max(0, requiredTotal - unreadCount);
  const progressPct =
    requiredTotal > 0 ? Math.round((readCount / requiredTotal) * 100) : 0;

  const isAllEmpty =
    recentTeam.length === 0 &&
    favorites.length === 0 &&
    requiredUnread.length === 0 &&
    recentlyViewed.length === 0 &&
    requiredTotal === 0;

  return (
    <div className="px-6 md:px-8 pt-5 pb-10 w-full flex flex-col gap-7">
      <header className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5 min-w-0">
            <h1 className="text-[28px] font-bold tracking-tight leading-tight">
              {firstName ? `Привет, ${firstName}!` : "База знаний"}
            </h1>
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <BookMarked className="size-4 shrink-0" />
              {unreadCount > 0
                ? `У вас ${unreadCount} ${articleWord(unreadCount)} к прочтению`
                : "SOP, регламенты, рецепты и онбординг команды"}
            </p>
          </div>
          {canCreate && <CreateRootPageButton />}
        </div>
        <KbSearchTrigger />
      </header>

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
            <section className="flex flex-col gap-4 rounded-xl border border-brand/20 bg-brand/5 p-6">
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
                  className="h-full rounded-full bg-brand transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {requiredUnread.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {requiredUnread.slice(0, 4).map((row) => (
                    <li key={row.id}>
                      <Link
                        href={`/knowledge/${row.slug}`}
                        className="flex items-center gap-3 rounded-lg border border-brand/20 bg-background px-4 py-3 transition-colors hover:border-brand/40"
                      >
                        <KbPageIcon
                          icon={row.icon}
                          color={row.icon_color}
                          size={18}
                        />
                        <span className="flex-1 truncate text-sm font-medium">
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
                      className="flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-accent/40"
                    >
                      <KbPageIcon
                        icon={row.icon}
                        color={row.icon_color}
                        size={22}
                      />
                      <span className="line-clamp-2 text-sm font-medium leading-snug">
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
    </div>
  );
}

/** RU-склонение «статья» по числу (обязательных к прочтению). */
function articleWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "обязательных статей";
  if (mod10 === 1) return "обязательная статья";
  if (mod10 >= 2 && mod10 <= 4) return "обязательные статьи";
  return "обязательных статей";
}
