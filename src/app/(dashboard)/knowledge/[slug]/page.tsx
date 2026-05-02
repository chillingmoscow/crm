import { notFound } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

import { createClient } from "@/lib/supabase/server";
import { getKbPageBySlug, listKbPages } from "@/lib/knowledge/pages";
import { getKbBreadcrumbs } from "@/lib/knowledge/tree";
import { KbBreadcrumbs } from "@/app/(dashboard)/knowledge/_components/kb-breadcrumbs";
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

  // Author of the last save (or original author if never edited) for
  // the «Обновлено … · Имя» line in the header.
  const lastEditorId = row.updated_by ?? row.created_by;

  const [
    { data: user },
    { data: hasEditAny },
    { data: hasEditOwn },
    { data: hasDelete },
    { rows: allPages },
    { chain },
    { data: lastEditor },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("has_permission", { permission_code: "kb.edit_any_page" }),
    supabase.rpc("has_permission", { permission_code: "kb.edit_own_pages" }),
    supabase.rpc("has_permission", { permission_code: "kb.delete_pages" }),
    listKbPages(),
    getKbBreadcrumbs(row.id),
    lastEditorId
      ? supabase
          .from("profiles")
          .select("first_name, last_name")
          .eq("id", lastEditorId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const canEdit =
    Boolean(hasEditAny) ||
    (Boolean(hasEditOwn) && row.created_by === user.user?.id);
  const canDelete = Boolean(hasDelete);
  const childCount = allPages.filter((p) => p.parent_id === row.id).length;

  const lastEditedAt = row.updated_at ?? row.created_at;
  const editorName = lastEditor
    ? [lastEditor.first_name, lastEditor.last_name].filter(Boolean).join(" ")
    : null;

  return (
    <article className="flex flex-col gap-6 px-8 py-6 max-w-4xl mx-auto">
      <header className="flex items-center justify-between gap-4">
        <KbBreadcrumbs chain={chain} />
        <div className="flex items-center gap-2">
          <KbVersionHistory pageId={row.id} canEdit={canEdit} />
          <KbPageActions
            pageId={row.id}
            pageTitle={row.title}
            childCount={childCount}
            canDelete={canDelete}
          />
        </div>
      </header>

      {lastEditedAt && (
        <p className="text-xs text-muted-foreground">
          Обновлено{" "}
          {formatDistanceToNow(new Date(lastEditedAt), {
            addSuffix: true,
            locale: ru,
          })}
          {editorName && (
            <>
              {" · "}
              <span className="text-foreground/80">{editorName}</span>
            </>
          )}
        </p>
      )}

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
    </article>
  );
}
