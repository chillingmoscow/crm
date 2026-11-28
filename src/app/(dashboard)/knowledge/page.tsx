import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

import { getCachedPermissions } from "@/lib/supabase/server";
import { listRecentKbPages } from "@/lib/knowledge/pages";
import { listMyKbFavorites } from "@/lib/knowledge/favorites";
import { getKbRequiredUnreadForUser } from "@/lib/knowledge/landing";
import { getKbTree } from "@/lib/knowledge/tree";
import { kbHomeSections } from "@/lib/knowledge/home";
import { EmptyState } from "@/components/ui/empty-state";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageFrame } from "@/components/shared/page-frame";
import { TablePageHeader } from "@/components/shared/table/table-page-header";
import { CreateRootPageButton } from "@/app/(dashboard)/knowledge/_components/create-root-page-button";
import {
  KbHomePageList,
  KbHomeSections,
  KbHomeToRead,
} from "@/app/(dashboard)/knowledge/_components/kb-home-blocks";

/**
 * Главная базы знаний (спека «Главная»): «К прочтению» с кольцом
 * (`#to-read` — на него ведёт пункт дерева), «Разделы» — страницы верхнего
 * уровня, «Недавно обновлённые» и «Избранное». Открыта всем, и значок
 * «База знаний» в меню ведёт сюда всех (решение владельца 28.11.2026);
 * «Обзор» — пункт дерева при праве. Пустые блоки скрыты; база пустая —
 * подсказка с «Создать страницу» при праве.
 */
export const metadata: Metadata = { title: "База знаний" };

export default async function KnowledgeLandingPage() {
  const perms = new Set(await getCachedPermissions());
  const canCreate = perms.has("kb.create_pages");

  const [{ rows: recent }, { pages: favorites }, { rows: unread, total: requiredTotal }, { nodes }] =
    await Promise.all([
      listRecentKbPages(6),
      listMyKbFavorites(),
      getKbRequiredUnreadForUser(),
      getKbTree(),
    ]);

  const sections = kbHomeSections(nodes);
  const isEmpty = nodes.length === 0 && requiredTotal === 0;
  const updatedAt = new Map(recent.map((r) => [r.id, r.updated_at ?? r.created_at]));

  return (
    <PageFrame className="flex flex-col gap-6">
      <Breadcrumbs items={[{ label: "База знаний" }]} />
      <TablePageHeader
        title="База знаний"
        actions={canCreate && !isEmpty ? <CreateRootPageButton /> : undefined}
      />

      {isEmpty ? (
        <EmptyState
          icon={BookOpen}
          title="Здесь пока нет страниц"
          description={
            canCreate
              ? "Создайте первую страницу, например регламент бара или чек-лист открытия смены."
              : "Когда коллеги добавят регламенты и материалы, они появятся здесь."
          }
          action={canCreate ? <CreateRootPageButton /> : undefined}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {requiredTotal > 0 && <KbHomeToRead rows={unread} total={requiredTotal} />}
          <KbHomeSections sections={sections} />
          {(recent.length > 0 || favorites.length > 0) && (
            <div
              className={
                recent.length > 0 && favorites.length > 0 ? "grid gap-6 lg:grid-cols-2" : "grid gap-6"
              }
            >
              <KbHomePageList
                title="Недавно обновлённые"
                rows={recent}
                trailing={(id) => {
                  const ts = updatedAt.get(id);
                  return ts ? (
                    <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                      {formatDistanceToNow(new Date(ts), { addSuffix: true, locale: ru })}
                    </span>
                  ) : null;
                }}
              />
              <KbHomePageList title="Избранное" rows={favorites} />
            </div>
          )}
        </div>
      )}
    </PageFrame>
  );
}
