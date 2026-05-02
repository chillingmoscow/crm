import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { listKbPages } from "@/lib/knowledge/pages";
import type { KbPageRow, KbTreeNode } from "@/types/knowledge";

/**
 * Build the full KB tree for the active account.
 *
 * Wrapped in React `cache()` so layout + sidebar tree component share
 * one fetch within a single render. Same pattern as getCachedUser
 * in src/lib/supabase/server.ts.
 *
 * Implementation: pull all non-deleted pages in one shot (one row per
 * page, RLS gates by account), then assemble the tree in memory. At
 * the expected scale (≤ 10k pages per account) this is faster than a
 * recursive CTE round-trip, and far simpler.
 */
export const getKbTree = cache(async (): Promise<{
  nodes: KbTreeNode[];
  error: string | null;
}> => {
  const { rows, error } = await listKbPages();
  if (error) return { nodes: [], error };
  return { nodes: assembleTree(rows), error: null };
});

/** Used by callers that already have the rows (e.g. the same RSC has
 * other queries on kb_pages and wants to reuse the data). Pure. */
export function assembleTree(rows: KbPageRow[]): KbTreeNode[] {
  const byId = new Map<string, KbTreeNode>();

  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      parent_id: row.parent_id,
      title: row.title,
      icon: row.icon,
      slug: row.slug,
      position: row.position,
      has_children: false,
      children: [],
    });
  }

  const roots: KbTreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      const parent = byId.get(node.parent_id)!;
      parent.children.push(node);
      parent.has_children = true;
    } else {
      // Root, or orphaned (parent soft-deleted/missing). Surface as root
      // so the page is still findable in the tree.
      roots.push(node);
    }
  }

  // Sort siblings by (position, title) for stable display.
  const sortRecursive = (nodes: KbTreeNode[]) => {
    nodes.sort(
      (a, b) =>
        a.position - b.position ||
        a.title.localeCompare(b.title, "ru", { sensitivity: "base" })
    );
    for (const n of nodes) sortRecursive(n.children);
  };
  sortRecursive(roots);

  return roots;
}

/**
 * Breadcrumb chain from root → leaf for a given page.
 * Returns null if the page is not found.
 */
export const getKbBreadcrumbs = cache(async (
  pageId: string
): Promise<{
  chain: Array<Pick<KbTreeNode, "id" | "title" | "icon" | "slug">>;
  error: string | null;
}> => {
  const supabase = await createClient();
  // Single RPC walks the parent chain in one round-trip.
  const { data, error } = await supabase.rpc("kb_get_ancestors", { p_page_id: pageId });
  if (error) return { chain: [], error: error.message };

  const chain = (data ?? []) as Array<{
    id: string;
    title: string;
    icon: string | null;
    slug: string;
  }>;
  return { chain, error: null };
});
