import { Suspense } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { getCachedPermissions } from "@/lib/supabase/server";
import { KbSidebarShell } from "@/app/(dashboard)/knowledge/_components/kb-sidebar-shell";
import {
  KbTreeLoader,
  KbMobileTreeLoader,
  KbTreeSkeleton,
} from "@/app/(dashboard)/knowledge/_components/kb-tree-loader";
import { KbLinkPreview } from "@/app/(dashboard)/knowledge/_components/kb-link-preview";
import { KbHotkeyListener } from "@/app/(dashboard)/knowledge/_components/kb-hotkey-listener";
import { KbSaveStatusBadge } from "@/app/(dashboard)/knowledge/_components/kb-save-status";
import { DashboardTopbar } from "@/components/shared/dashboard-topbar";
import { canOpenKbOverview } from "@/lib/knowledge/shell";

/**
 * Knowledge Base shell. Gates the entire /knowledge/* tree on
 * `kb.view_pages` (migration 050). Renders a two-column layout:
 *   ─ left: full-height sticky KB tree (Notion-style page navigator)
 *   ─ right: page content with its own slim top-bar
 *
 * Tree streaming: KbTreeLoader / KbMobileTreeLoader are wrapped in
 * <Suspense> so page content streams to the browser before the tree
 * rows are fetched. getKbTree() uses React cache() — both loaders
 * share a single DB round-trip within the same render pass.
 *
 * Permission caching: getCachedPermissions / getCachedActiveAccountId
 * are React cache() wrappers; dashboard layout already called them,
 * so no extra DB hit here.
 */
export default async function KnowledgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const permissions = await getCachedPermissions();

  const permSet = new Set(permissions);
  const canView = permSet.has("kb.view_pages");
  const canDelete = permSet.has("kb.delete_pages");
  const canImport = permSet.has("kb.import_pages");
  const canCreate = permSet.has("kb.create_pages");
  const canManageTemplates = permSet.has("kb.manage_templates");
  if (!canView) redirect("/dashboard");

  const cookieStore = await cookies();
  const sidebarWidthCookie = cookieStore.get("kb_sidebar_width")?.value;
  const sidebarInitialWidth = sidebarWidthCookie
    ? Number.parseInt(sidebarWidthCookie, 10)
    : undefined;
  const sidebarHidden = cookieStore.get("kb_sidebar_hidden")?.value === "true";

  const treePermissions = {
    canSeeTrash: canDelete,
    canDelete,
    canDuplicate: canCreate,
    // «Обзор» открывается при любом из трёх прав; блоки внутри — каждый
    // при своём (спека редизайна, «Решения по вопросам проверки»).
    canViewOverview: canOpenKbOverview(permSet),
    canImport,
    canCreate,
    canManageTemplates,
  };

  return (
    <>
      <KbHotkeyListener />
      {/* min-h считаем за вычетом баннера режима просмотра: он живёт выше
          по дереву и прибавляет свою высоту. С голым min-h-svh страница
          становится выше экрана, окно начинает скроллиться, и вместе с ним
          уезжает сам баннер. --impersonation-offset задаёт dashboard-layout,
          вне режима просмотра он равен 0px. */}
      <div className="flex w-full min-h-[calc(100svh_-_var(--impersonation-offset,0px))]">
        <KbSidebarShell
          initialHidden={sidebarHidden}
          sidebarInitialWidth={
            sidebarInitialWidth && !Number.isNaN(sidebarInitialWidth)
              ? sidebarInitialWidth
              : undefined
          }
        >
          {/* Desktop tree streams independently — page content renders
              without waiting for tree rows. Both loaders share one DB
              fetch via getKbTree() React cache(). */}
          <Suspense fallback={<KbTreeSkeleton />}>
            <KbTreeLoader {...treePermissions} />
          </Suspense>
        </KbSidebarShell>
        <main className="flex-1 min-w-0 flex flex-col">
          {/* Общая верхняя панель приложения (та же, что в остальных
              разделах), но внутри правой колонки: дерево слева идёт во всю
              высоту экрана. На телефоне перед путём — «Страницы». */}
          <DashboardTopbar
            inKnowledge
            leading={
              <div className="md:hidden">
                <Suspense fallback={null}>
                  <KbMobileTreeLoader {...treePermissions} />
                </Suspense>
              </div>
            }
            afterBreadcrumb={
              <div className="hidden md:flex">
                <KbSaveStatusBadge />
              </div>
            }
          />
          {children}
        </main>
      </div>
      <KbLinkPreview />
    </>
  );
}
