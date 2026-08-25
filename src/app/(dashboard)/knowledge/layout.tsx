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
import { KbMobileSubHeader } from "@/app/(dashboard)/knowledge/_components/kb-mobile-sub-header";
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
  const canViewAudit = permSet.has("org.view_audit");
  const canViewAnalytics = permSet.has("kb.view_analytics");
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
    canViewAudit,
    canViewAnalytics,
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
          {/* Шапка. Mobile: верхняя строка — переключатель сайдбара +
              «Страницы» + действия + колокольчик; breadcrumb и «Сохранено»
              уезжают во вторую строку (ниже). Desktop: всё в одной строке как
              было (breadcrumb + «Сохранено»), «Страницы» нет — есть боковое
              дерево. Слоты breadcrumb/actions — context-консьюмеры, безопасно
              рендерятся в двух местах (видно одно по брейкпоинту). */}
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 px-4 md:px-6 bg-background/95 backdrop-blur">
            <SidebarTrigger className="md:hidden" />
            {/* Mobile: «Страницы» в шапке */}
            <div className="md:hidden">
              <Suspense fallback={null}>
                <KbMobileTreeLoader {...treePermissions} />
              </Suspense>
            </div>
            {/* Desktop: breadcrumb + «Сохранено» в шапке */}
            <div className="hidden flex-1 items-center gap-2 md:flex">
              <PageHeaderBreadcrumbSlot />
              <div className="flex-1" />
              <KbSaveStatusBadge />
            </div>
            <div className="flex-1 md:hidden" />
            <PageHeaderActionsSlot />
            <NotificationBell />
          </header>
          {/* Mobile-only вторая строка: breadcrumb + «Сохранено». Рендерится
              только когда breadcrumb задан (страницы-редакторы) — на корне БЗ /
              дашборде (hideBreadcrumb) пустой полосы нет (Codex P2 на #438). */}
          <KbMobileSubHeader />
          {children}
        </main>
      </div>
      <KbLinkPreview />
    </>
  );
}
