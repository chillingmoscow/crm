import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getKbPageBySlug, listKbPages } from "@/lib/knowledge/pages";
import { getKbBreadcrumbs } from "@/lib/knowledge/tree";
import {
  PageBreadcrumb,
  PageHeaderActions,
} from "@/components/shared/page-header-actions";
import { EntityInfoPopover } from "@/components/shared/entity-info-popover";
import { KbPageEditor } from "@/app/(dashboard)/knowledge/_components/kb-page-editor";
import { KbVersionHistory } from "@/app/(dashboard)/knowledge/_components/kb-version-history";
import { KbBacklinks } from "@/app/(dashboard)/knowledge/_components/kb-backlinks";
import { KbPageActions } from "@/app/(dashboard)/knowledge/_components/kb-page-actions";
import type { KbBlock } from "@/types/knowledge";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function KbPageView({ params }: PageProps) {
  const { slug } = await params;
  const { row, error } = await getKbPageBySlug(slug);
  if (error || !row) notFound();

  // Auth context for permission gating. RLS on the row already ran;
  // these RPCs are advisory — the editor disables itself when canEdit
  // is false and the «Удалить» button hides when canDelete is false.
  const supabase = await createClient();

  const lastEditorId = row.updated_by ?? row.created_by;
  const profileIds = Array.from(
    new Set(
      [row.created_by, row.updated_by].filter((id): id is string => !!id),
    ),
  );

  const [
    { data: user },
    { data: hasEditAny },
    { data: hasEditOwn },
    { data: hasDelete },
    { rows: allPages },
    { chain },
    { data: profiles },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("has_permission", { permission_code: "kb.edit_any_page" }),
    supabase.rpc("has_permission", { permission_code: "kb.edit_own_pages" }),
    supabase.rpc("has_permission", { permission_code: "kb.delete_pages" }),
    listKbPages(),
    getKbBreadcrumbs(row.id),
    profileIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", profileIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null }[] }),
  ]);

  const canEdit =
    Boolean(hasEditAny) ||
    (Boolean(hasEditOwn) && row.created_by === user.user?.id);
  const canDelete = Boolean(hasDelete);
  const childCount = allPages.filter((p) => p.parent_id === row.id).length;

  // Resolve back-link target: parent page if any, else /knowledge.
  // chain comes root → leaf, last entry is the current page itself.
  const parent = chain.length >= 2 ? chain[chain.length - 2] : null;
  const backHref = parent ? `/knowledge/${parent.slug}` : "/knowledge";
  const backLabel = parent
    ? parent.title || "Без названия"
    : "База знаний";

  // Profile lookup for info-popover audit fields.
  const profilesById = new Map<string, string>();
  for (const p of profiles ?? []) {
    const parts = [p.first_name, p.last_name].filter(Boolean) as string[];
    profilesById.set(p.id, parts.length > 0 ? parts.join(" ") : "—");
  }
  const createdByName = row.created_by
    ? profilesById.get(row.created_by) ?? null
    : null;
  const updatedByName = row.updated_by
    ? profilesById.get(row.updated_by) ?? null
    : lastEditorId
      ? profilesById.get(lastEditorId) ?? null
      : null;

  return (
    <div className="flex-1 flex flex-col">
      {/* Breadcrumb in layout's top bar (left side) — single ← link
          back to parent page (or /knowledge for root pages). */}
      <PageBreadcrumb>
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          {backLabel}
        </Link>
      </PageBreadcrumb>

      {/* Right-side actions in top bar — history, delete, info popover.
          History/Delete are KB-specific entity actions; info popover
          carries createdAt/updatedAt/by audit data per DS convention. */}
      <PageHeaderActions>
        <KbVersionHistory pageId={row.id} canEdit={canEdit} />
        <KbPageActions
          pageId={row.id}
          pageTitle={row.title}
          childCount={childCount}
          canDelete={canDelete}
        />
        <EntityInfoPopover
          title="О странице"
          id={row.id}
          createdAt={row.created_at}
          createdByName={createdByName}
          updatedAt={row.updated_at}
          updatedByName={updatedByName}
        />
      </PageHeaderActions>

      {/* Page body — full-width container; editor itself is centred
          to ~720px for Notion-like reading width (DS pattern для
          entity-detail body, см. docs/design-system.md). */}
      <div className="px-6 md:px-8 pt-4 pb-8 w-full flex flex-col gap-6">
        <div className="mx-auto w-full max-w-[760px] flex flex-col gap-6">
          {/*
            Key by (id, updated_at). Normal auto-save doesn't bump
            updated_at in the current view (no router.refresh after save),
            so the cursor survives typing. Version restore DOES call
            router.refresh, which re-fetches the row with new updated_at →
            editor remounts with the restored content.
          */}
          <KbPageEditor
            key={`${row.id}-${row.updated_at ?? row.created_at}`}
            pageId={row.id}
            initialTitle={row.title}
            initialIcon={row.icon}
            initialContent={(row.content as unknown as KbBlock[]) ?? []}
            canEdit={canEdit}
          />

          <KbBacklinks pageId={row.id} />
        </div>
      </div>
    </div>
  );
}
