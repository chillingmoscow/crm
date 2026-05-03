import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getKbPageBySlug, listKbPages } from "@/lib/knowledge/pages";
import { isKbPageFavorited } from "@/lib/knowledge/favorites";
import { getKbBreadcrumbs } from "@/lib/knowledge/tree";
import {
  PageBreadcrumb,
  PageHeaderActions,
} from "@/components/shared/page-header-actions";
import { EntityInfoPopover } from "@/components/shared/entity-info-popover";
import { KbBackLink } from "@/app/(dashboard)/knowledge/_components/kb-back-link";
import { KbFavoriteToggle } from "@/app/(dashboard)/knowledge/_components/kb-favorite-toggle";
import { KbPageEditor } from "@/app/(dashboard)/knowledge/_components/kb-page-editor";
import { KbVersionHistory } from "@/app/(dashboard)/knowledge/_components/kb-version-history";
import { KbBacklinks } from "@/app/(dashboard)/knowledge/_components/kb-backlinks";
import { KbPageActions } from "@/app/(dashboard)/knowledge/_components/kb-page-actions";
import type { KbBlock, KbPageRow } from "@/types/knowledge";

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
    { data: hasCreate },
    { data: hasExport },
    { favorited },
    { rows: allPages },
    { chain },
    { data: profiles },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("has_permission", { permission_code: "kb.edit_any_page" }),
    supabase.rpc("has_permission", { permission_code: "kb.edit_own_pages" }),
    supabase.rpc("has_permission", { permission_code: "kb.delete_pages" }),
    supabase.rpc("has_permission", { permission_code: "kb.create_pages" }),
    supabase.rpc("has_permission", { permission_code: "kb.export_pages" }),
    isKbPageFavorited(row.id),
    listKbPages(),
    getKbBreadcrumbs(row.id),
    profileIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, first_name, last_name, avatar_url")
          .in("id", profileIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }[] }),
  ]);

  const canEdit =
    Boolean(hasEditAny) ||
    (Boolean(hasEditOwn) && row.created_by === user.user?.id);
  const canDelete = Boolean(hasDelete);
  const canDuplicate = Boolean(hasCreate);
  const canExport = Boolean(hasExport);
  // Total descendants — нужно для текста подтверждения удаления
  // (cascade soft-delete заберёт всю ветку, не только direct children).
  const descendantsCount = countDescendants(allPages, row.id);

  // Resolve back-link target: parent page if any, else /knowledge.
  // chain comes root → leaf, last entry is the current page itself.
  const parent = chain.length >= 2 ? chain[chain.length - 2] : null;
  const backHref = parent ? `/knowledge/${parent.slug}` : "/knowledge";
  const backLabel = parent
    ? parent.title || "Без названия"
    : "База знаний";

  // Profile lookup for info-popover audit fields.
  type ProfileEntry = { name: string; avatarUrl: string | null };
  const profilesById = new Map<string, ProfileEntry>();
  for (const p of profiles ?? []) {
    const parts = [p.first_name, p.last_name].filter(Boolean) as string[];
    profilesById.set(p.id, {
      name: parts.length > 0 ? parts.join(" ") : "—",
      avatarUrl: p.avatar_url ?? null,
    });
  }
  const createdByName = row.created_by
    ? profilesById.get(row.created_by)?.name ?? null
    : null;
  const updatedByEntry = row.updated_by
    ? profilesById.get(row.updated_by) ?? null
    : lastEditorId
      ? profilesById.get(lastEditorId) ?? null
      : null;
  const updatedByName = updatedByEntry?.name ?? null;
  const updatedByAvatarUrl = updatedByEntry?.avatarUrl ?? null;

  // Profile lookup for the author (Создал) — нужен только для аватарки
  // в info-popover; имя уже посчитали выше.
  const createdByEntry = row.created_by
    ? profilesById.get(row.created_by) ?? null
    : null;
  const createdByAvatarUrl = createdByEntry?.avatarUrl ?? null;

  return (
    <div className="flex-1 flex flex-col">
      {/* Top-bar slots (теперь отрисовываются в KB-собственном header'е,
          см. knowledge/layout.tsx). Левая часть — breadcrumb back-link,
          правая — version history, delete, info popover. */}
      <PageBreadcrumb>
        <KbBackLink href={backHref} label={backLabel} />
      </PageBreadcrumb>
      <PageHeaderActions>
        <KbFavoriteToggle pageId={row.id} initialFavorited={favorited} />
        <KbVersionHistory pageId={row.id} canEdit={canEdit} />
        <KbPageActions
          pageId={row.id}
          pageTitle={row.title}
          childCount={descendantsCount}
          canDelete={canDelete}
          canDuplicate={canDuplicate}
          canExport={canExport}
        />
        <EntityInfoPopover
          title="О странице"
          id={row.id}
          createdAt={row.created_at}
          createdByName={createdByName}
          createdByAvatarUrl={createdByAvatarUrl}
          createdByLabel="Автор"
          updatedAt={row.updated_at}
          updatedByName={updatedByName}
          updatedByAvatarUrl={updatedByAvatarUrl}
          updatedByLabel="Редактор"
          showTime
          relativeUpdatedAt
        />
      </PageHeaderActions>

      {/* Page body — full-width container; editor itself is centred
          to ~720px for Notion-like reading width. */}
      <div className="px-6 md:px-8 pt-6 pb-8 w-full flex flex-col gap-3">
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
            initialIconColor={row.icon_color}
            initialContent={(row.content as unknown as KbBlock[]) ?? []}
            canEdit={canEdit}
          />

          <KbBacklinks pageId={row.id} />
        </div>
      </div>
    </div>
  );
}

/** Recursive descendants count via in-memory walk (cheap on KB scale). */
function countDescendants(allPages: KbPageRow[], rootId: string): number {
  const childrenByParent = new Map<string, string[]>();
  for (const p of allPages) {
    if (!p.parent_id) continue;
    const arr = childrenByParent.get(p.parent_id) ?? [];
    arr.push(p.id);
    childrenByParent.set(p.parent_id, arr);
  }
  let count = 0;
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const kids = childrenByParent.get(id) ?? [];
    count += kids.length;
    stack.push(...kids);
  }
  return count;
}
