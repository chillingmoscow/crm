import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getKbPageBySlug, listKbPages, resolveLiveKbSlugs } from "@/lib/knowledge/pages";
import { extractBacklinks } from "@/lib/knowledge/backlinks";
import { isKbPageFavorited } from "@/lib/knowledge/favorites";
import { getKbPageReadStatus } from "@/lib/knowledge/required-reading";
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
import { KbUndoRedoButtons } from "@/app/(dashboard)/knowledge/_components/kb-undo-redo-buttons";
import { KbRequiredReadingBanner } from "@/app/(dashboard)/knowledge/_components/kb-required-reading-banner";
import { KbRequiredReadingToggle } from "@/app/(dashboard)/knowledge/_components/kb-required-reading-toggle";
import { KbRequiredReadingStatsLink } from "@/app/(dashboard)/knowledge/_components/kb-required-reading-stats-link";
import { KbPageAnalyticsLink } from "@/app/(dashboard)/knowledge/_components/kb-page-analytics-link";
import { KbPageLockToggle } from "@/app/(dashboard)/knowledge/_components/kb-page-lock-toggle";
import { estimateReadingMinutes } from "@/lib/knowledge/reading-time";
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

  // Current user — нужен заранее, чтобы включить его id в profileIds
  // (для аватарки в comment-композере) ещё до основного Promise.all.
  const { data: currentUserData } = await supabase.auth.getUser();
  const currentUserId = currentUserData.user?.id ?? null;

  const lastEditorId = row.updated_by ?? row.created_by;
  const profileIds = Array.from(
    new Set(
      [row.created_by, row.updated_by, row.locked_by, currentUserId].filter(
        (id): id is string => !!id,
      ),
    ),
  );

  const [
    { data: hasEditAny },
    { data: hasEditOwn },
    { data: hasDelete },
    { data: hasCreate },
    { data: hasExport },
    { data: hasManageTemplates },
    { data: hasUseAi },
    { data: hasComment },
    { data: hasManageRequiredReading },
    { data: hasLockPages },
    { data: hasViewAnalytics },
    { data: activeAccountId },
    { favorited },
    readStatus,
    { rows: allPages },
    { chain },
    { data: profiles },
  ] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "kb.edit_any_page" }),
    supabase.rpc("has_permission", { permission_code: "kb.edit_own_pages" }),
    supabase.rpc("has_permission", { permission_code: "kb.delete_pages" }),
    supabase.rpc("has_permission", { permission_code: "kb.create_pages" }),
    supabase.rpc("has_permission", { permission_code: "kb.export_pages" }),
    supabase.rpc("has_permission", { permission_code: "kb.manage_templates" }),
    supabase.rpc("has_permission", { permission_code: "kb.use_ai" }),
    supabase.rpc("has_permission", { permission_code: "kb.comment_pages" }),
    supabase.rpc("has_permission", { permission_code: "kb.manage_required_reading" }),
    supabase.rpc("has_permission", { permission_code: "kb.lock_pages" }),
    supabase.rpc("has_permission", { permission_code: "kb.view_analytics" }),
    supabase.rpc("get_active_account_id"),
    isKbPageFavorited(row.id),
    getKbPageReadStatus(row.id),
    listKbPages(),
    getKbBreadcrumbs(row.id),
    profileIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, first_name, last_name, avatar_url")
          .in("id", profileIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }[] }),
  ]);

  // Базовая edit-permission. Lock-state ограничивает её отдельно ниже:
  // canEditEffective = canEdit && (!locked || canLock).
  const canEditBase =
    Boolean(hasEditAny) ||
    (Boolean(hasEditOwn) && row.created_by === currentUserId);
  const canDelete = Boolean(hasDelete);
  const canDuplicate = Boolean(hasCreate);
  const canExport = Boolean(hasExport);
  const canManageTemplates = Boolean(hasManageTemplates);
  const canManageRequiredReading = Boolean(hasManageRequiredReading);
  const canLock = Boolean(hasLockPages);
  const canViewAnalytics = Boolean(hasViewAnalytics);

  // Effective edit-permission: если страница заблокирована — editor
  // read-only ДЛЯ ВСЕХ, включая admin'а с kb.lock_pages. Чтобы edit'ить
  // надо явно разблокировать через banner-кнопку. Backend RPC
  // kb_save_page (миграция 086) отвергает любой write на locked-странице.
  const isLocked = row.locked_at !== null;
  const canEdit = canEditBase && !isLocked;

  // AI slash-команды: двойной gate. UI-уровень — чтобы не показывать
  // /ai-айтемы в slash-меню если account отключил AI или у юзера
  // нет права. Server-action runKbAiCommand перепроверит.
  let aiSlashEnabled = false;
  if (Boolean(hasUseAi) && activeAccountId) {
    const { data: accountRow } = await supabase
      .from("accounts")
      .select("ai_enabled")
      .eq("id", activeAccountId as unknown as string)
      .maybeSingle();
    aiSlashEnabled = Boolean(accountRow?.ai_enabled);
  }
  // Total descendants — нужно для текста подтверждения удаления
  // (cascade soft-delete заберёт всю ветку, не только direct children).
  const descendantsCount = countDescendants(allPages, row.id);

  // Резолвим, какие kbPageMention chip'ы в текущем content ведут на
  // ЖИВЫЕ страницы. Те, что не в результате — рендерятся в редакторе
  // как disabled chip'ы (страница в корзине / удалена / hard-delete /
  // импорт из чужого аккаунта). Без этого admin'ы с kb.delete_pages
  // могли клик'нуть на chip и попасть в notFound() (после фильтра
  // deleted_at в getKbPageBySlug). Ниже рантайм-резолвинг по slug'ам:
  // single SQL-IN-запрос, ≤ 100 mention'ов на странице на практике.
  const contentBlocks =
    (row.content as unknown as KbBlock[]) ?? [];
  const { slugs: mentionSlugs } = extractBacklinks(contentBlocks);
  const liveMentionSlugsSet = await resolveLiveKbSlugs(mentionSlugs);
  const liveMentionSlugs = Array.from(liveMentionSlugsSet);

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

  // Current user — для аватарки и имени в comment-композере.
  const currentUserProfile = currentUserId
    ? profilesById.get(currentUserId) ?? null
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
        {/* Toggle'ы синхронизируют свой useState с initialXxx prop'ом
            через useEffect — это альтернатива key-remount'у. key-фикс
            ломал PageHeaderActions slot (cumulative набор иконок при
            навигации), потому что Slot держит ReactNode в context
            state'е, а keyed remount при концентрации действий через
            context провоцировал reconciliation двух вариантов одного
            slot'а. Prop-sync в самих компонентах решает проблему без
            remount'а. */}
        <KbFavoriteToggle pageId={row.id} initialFavorited={favorited} />
        {canManageRequiredReading && (
          <KbRequiredReadingToggle
            pageId={row.id}
            initialRequired={readStatus.required}
          />
        )}
        {canManageRequiredReading && readStatus.required && (
          <KbRequiredReadingStatsLink slug={row.slug} />
        )}
        {canLock && (
          <KbPageLockToggle pageId={row.id} initialLocked={isLocked} />
        )}
        {canViewAnalytics && <KbPageAnalyticsLink slug={row.slug} />}
        <KbUndoRedoButtons canEdit={canEdit} />
        <KbVersionHistory pageId={row.id} canEdit={canEdit} />
        <KbPageActions
          pageId={row.id}
          pageTitle={row.title}
          childCount={descendantsCount}
          canDelete={canDelete}
          canDuplicate={canDuplicate}
          canExport={canExport}
          canManageTemplates={canManageTemplates}
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
          {/* Required-reading баннер (только если флаг включён) или
              compact-badge «✓ Прочитано» если уже подтверждено. */}
          <KbRequiredReadingBanner
            pageId={row.id}
            required={readStatus.required}
            initialReadAt={readStatus.myReadAt}
            needsReread={readStatus.needsReread}
            readingMinutes={
              row.plain_text && row.plain_text.trim().length > 0
                ? estimateReadingMinutes(row.plain_text)
                : null
            }
          />
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
            initialContent={contentBlocks}
            liveMentionSlugs={liveMentionSlugs}
            canEdit={canEdit}
            aiSlashEnabled={aiSlashEnabled}
            canComment={Boolean(hasComment)}
            accountId={(activeAccountId as unknown as string | null) ?? null}
            userId={currentUserId}
            currentUserName={currentUserProfile?.name ?? null}
            currentUserAvatarUrl={currentUserProfile?.avatarUrl ?? null}
            readingMinutes={
              row.plain_text && row.plain_text.trim().length > 0
                ? estimateReadingMinutes(row.plain_text)
                : null
            }
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
