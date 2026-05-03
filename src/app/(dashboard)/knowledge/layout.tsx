import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getKbTree } from "@/lib/knowledge/tree";
import { listMyKbFavorites } from "@/lib/knowledge/favorites";
import { KbTreeNav } from "@/app/(dashboard)/knowledge/_components/kb-tree-nav";
import { KbSearchProvider } from "@/app/(dashboard)/knowledge/_components/kb-search-dialog";
import { KbMobileTreeDrawer } from "@/app/(dashboard)/knowledge/_components/kb-mobile-tree-drawer";
import { KbSaveStatusBadge } from "@/app/(dashboard)/knowledge/_components/kb-save-status";
import { NotificationBell } from "@/components/shared/notification-bell";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  PageHeaderActionsSlot,
  PageHeaderBreadcrumbSlot,
} from "@/components/shared/page-header-actions";

/**
 * Knowledge Base shell. Gates the entire /knowledge/* tree on
 * `kb.view_pages` (migration 050). Renders a two-column layout:
 *   ─ left: full-height sticky KB tree (Notion-style page navigator)
 *   ─ right: page content with its own slim top-bar
 *
 * Dashboard topbar скрывается на /knowledge (см. DashboardTopbar) —
 * KB-сайдбар занимает полную высоту экрана, а action-кнопки и
 * breadcrumb рендерятся в локальном top-bar справа от дерева. Слоты
 * (PageHeaderActionsSlot/BreadcrumbSlot) шарят тот же React-context,
 * что и дашборд: одновременно mounted только один consumer.
 *
 * Mobile (<md): tree column collapses out; users navigate via the
 * landing page list, search dialog, or direct URL.
 */
export default async function KnowledgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const [{ data: canView }, { data: canDelete }] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "kb.view_pages" }),
    supabase.rpc("has_permission", { permission_code: "kb.delete_pages" }),
  ]);
  if (!canView) redirect("/dashboard");

  // Tree + favorites параллельно. KbTreeNav reads from React cache
  // (getKbTree wraps listKbPages с React.cache), no double-fetch.
  const [{ nodes }, { pages: favorites }] = await Promise.all([
    getKbTree(),
    listMyKbFavorites(),
  ]);

  return (
    <KbSearchProvider>
      {/* Полная высота viewport: dashboard topbar скрыт на /knowledge,
          поэтому aside поднят к самому верху. svh (а не vh) — потому
          что SidebarProvider дашборда использует ту же единицу, иначе
          на мобильных платформах с динамическим toolbar'ом колонки
          не совпадают по высоте. */}
      <div className="flex w-full min-h-svh">
        <aside
          aria-label="Дерево страниц"
          className="hidden md:flex sticky top-0 h-svh w-72 shrink-0
                     flex-col border-r bg-sidebar"
        >
          <KbTreeNav
            nodes={nodes}
            favorites={favorites}
            canSeeTrash={Boolean(canDelete)}
          />
        </aside>
        <main className="flex-1 min-w-0 flex flex-col">
          {/* KB-локальный top-bar: breadcrumb слева, actions + bell
              справа. h-14 совпадает с дашборд-топбаром на других
              маршрутах, чтобы кнопки сохраняли свою позицию. */}
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 px-6 bg-background/95 backdrop-blur">
            <SidebarTrigger className="md:hidden" />
            <PageHeaderBreadcrumbSlot />
            <div className="flex-1" />
            {/* Save-state badge — рядом с History/Delete/Info справа.
                Подписан на module-store, не зависит от render-цикла
                редактора → popover'ы редактора больше не дёргаются. */}
            <KbSaveStatusBadge />
            <PageHeaderActionsSlot />
            <NotificationBell />
          </header>
          {/* Mobile-only sticky bar with tree-drawer trigger. */}
          <div className="md:hidden sticky top-14 z-20 border-b bg-background/95
                          px-4 py-2 backdrop-blur">
            <KbMobileTreeDrawer
              nodes={nodes}
              favorites={favorites}
              canSeeTrash={Boolean(canDelete)}
            />
          </div>
          {children}
        </main>
      </div>
    </KbSearchProvider>
  );
}
