import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getKbTree } from "@/lib/knowledge/tree";
import { KbTreeNav } from "@/app/(dashboard)/knowledge/_components/kb-tree-nav";

/**
 * Knowledge Base shell. Gates the entire /knowledge/* tree on
 * `kb.view_pages` (migration 050). Renders a two-column layout:
 *   ─ left: sticky KB tree (Notion-style page navigator)
 *   ─ right: page content (children)
 *
 * Mobile (<md): tree column collapses out; users navigate via the
 * landing page list, search dialog (Stage 8.5), or direct URL.
 * Mobile drawer-tree is part of the deferred scope (plan §8.5).
 */
export default async function KnowledgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: canView } = await supabase.rpc("has_permission", {
    permission_code: "kb.view_pages",
  });
  if (!canView) redirect("/dashboard");

  // Single fetch — KbTreeNav reads from React cache (getKbTree wraps
  // listKbPages with React.cache), so we don't double-fetch.
  const { nodes } = await getKbTree();

  return (
    <div className="flex w-full min-h-[calc(100vh-3rem)]">
      <aside
        aria-label="Дерево страниц"
        className="hidden md:flex sticky top-12 h-[calc(100vh-3rem)] w-72 shrink-0
                   flex-col border-r bg-sidebar overflow-y-auto"
      >
        <KbTreeNav nodes={nodes} />
      </aside>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
