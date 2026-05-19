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
      <div className="flex w-full min-h-svh">
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
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 px-6 bg-background/95 backdrop-blur">
            <SidebarTrigger className="md:hidden" />
            <PageHeaderBreadcrumbSlot />
            <div className="flex-1" />
            <KbSaveStatusBadge />
            <PageHeaderActionsSlot />
            <NotificationBell />
          </header>
          {/* Mobile-only sticky bar with tree-drawer trigger. */}
          <div className="md:hidden sticky top-14 z-20 border-b bg-background/95 px-4 py-2 backdrop-blur">
            <Suspense fallback={null}>
              <KbMobileTreeLoader {...treePermissions} />
            </Suspense>
          </div>
          {children}
        </main>
      </div>
      <KbLinkPreview />
    </>
  );
}
