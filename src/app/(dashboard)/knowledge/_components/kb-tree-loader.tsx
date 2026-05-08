import { getKbTree } from "@/lib/knowledge/tree";
import { listMyKbFavorites } from "@/lib/knowledge/favorites";
import { KbTreeNav } from "@/app/(dashboard)/knowledge/_components/kb-tree-nav";
import { KbMobileTreeDrawer } from "@/app/(dashboard)/knowledge/_components/kb-mobile-tree-drawer";
import { Skeleton } from "@/components/ui/skeleton";

interface KbTreeNavPermissions {
  canSeeTrash: boolean;
  canDelete: boolean;
  canDuplicate: boolean;
  canViewAudit: boolean;
  canViewAnalytics: boolean;
  canImport: boolean;
  canCreate: boolean;
  canManageTemplates: boolean;
}

/**
 * Async RSC: fetches tree + favorites, renders the desktop sidebar nav.
 * Intentionally split from KnowledgeLayout so the tree can stream via
 * <Suspense> — page content renders before this resolves.
 * getKbTree() uses React cache(), so a concurrent KbMobileTreeLoader
 * in the same render pass shares the same DB fetch.
 */
export async function KbTreeLoader(props: KbTreeNavPermissions) {
  const [{ nodes }, { pages: favorites }] = await Promise.all([
    getKbTree(),
    listMyKbFavorites(),
  ]);

  return (
    <KbTreeNav
      nodes={nodes}
      favorites={favorites}
      canSeeTrash={props.canSeeTrash}
      canDelete={props.canDelete}
      canDuplicate={props.canDuplicate}
      canViewAudit={props.canViewAudit}
      canViewAnalytics={props.canViewAnalytics}
      canImport={props.canImport}
      canCreate={props.canCreate}
      canManageTemplates={props.canManageTemplates}
    />
  );
}

/**
 * Mobile-only async RSC: same data as KbTreeLoader, but renders the
 * sticky mobile drawer trigger. getKbTree() is React-cached — no
 * second DB round-trip when both components render in the same pass.
 */
export async function KbMobileTreeLoader(props: KbTreeNavPermissions) {
  const [{ nodes }, { pages: favorites }] = await Promise.all([
    getKbTree(),
    listMyKbFavorites(),
  ]);

  return (
    <KbMobileTreeDrawer
      nodes={nodes}
      favorites={favorites}
      canSeeTrash={props.canSeeTrash}
      canDelete={props.canDelete}
      canDuplicate={props.canDuplicate}
      canViewAudit={props.canViewAudit}
      canViewAnalytics={props.canViewAnalytics}
      canImport={props.canImport}
      canCreate={props.canCreate}
      canManageTemplates={props.canManageTemplates}
    />
  );
}

/** Placeholder shown while KbTreeLoader streams. */
export function KbTreeSkeleton() {
  return (
    <div className="flex flex-col gap-1 px-2 py-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-7 rounded-md"
          style={{ width: `${60 + (i % 3) * 15}%`, opacity: 1 - i * 0.08 }}
        />
      ))}
    </div>
  );
}
