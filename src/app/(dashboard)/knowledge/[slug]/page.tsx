import { notFound } from "next/navigation";

import { createClient, getCachedActiveAccountId, getCachedPermissions } from "@/lib/supabase/server";
import {
  getDeletedKbPageBySlug,
  getKbPageBySlug,
  getKbPageViewData,
  resolveKbMentionTargets,
} from "@/lib/knowledge/pages";
import { extractBacklinks } from "@/lib/knowledge/backlinks";
import { getKbTreeRows } from "@/lib/knowledge/tree";
import {
  PageBreadcrumb,
  PageHeaderActions,
} from "@/components/shared/page-header-actions";
import { KbBackLink } from "@/app/(dashboard)/knowledge/_components/kb-back-link";
import { KbDeletedPageBanner } from "@/app/(dashboard)/knowledge/_components/kb-deleted-page-banner";
import { KbPageEditor } from "@/app/(dashboard)/knowledge/_components/kb-page-editor";
import { KbBacklinks } from "@/app/(dashboard)/knowledge/_components/kb-backlinks";
import { KbChildrenList } from "@/app/(dashboard)/knowledge/_components/kb-children-list";
import { KbRequiredReadingBanner } from "@/app/(dashboard)/knowledge/_components/kb-required-reading-banner";
import { KbPageMenu } from "@/app/(dashboard)/knowledge/_components/kb-page-menu";
import { estimateReadingMinutes } from "@/lib/knowledge/reading-time";
import { kbPropertiesSchema } from "@/lib/knowledge/schemas";
import type {
  KbBlock,
  KbPageRow,
  KbPageTreeRow,
  KbProperty,
} from "@/types/knowledge";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function KbPageView({ params }: PageProps) {
  const { slug } = await params;
  const { row, error } = await getKbPageBySlug(slug);
  if (error) notFound();
  if (!row) {
    // Notion-style: страница из корзины не 404-ит, а открывается
    // read-only с баннером. getDeletedKbPageBySlug RLS-гейтится на
    // `kb.delete_pages` — рядовой сотрудник получит null → notFound.
    const { row: deletedRow } = await getDeletedKbPageBySlug(slug);
    if (!deletedRow) notFound();
    return <DeletedKbPageView row={deletedRow} />;
  }

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

  // Pre-compute mentionSlugs из row.content — `extractBacklinks` чисто
  // in-memory, не требует await. Раньше resolveKbMentionTargets ждал
  // основной Promise.all → дополнительный последовательный RTT. Сейчас
  // он стартует параллельно с остальными запросами (data-deps только на
  // `row`, которая уже загружена). Same logic for `accounts.ai_enabled`:
  // раньше запрашивалось отдельно после Promise.all (с зависимостью от
  // permissions+activeAccountId), теперь — внутри inline-IIFE, который
  // дожидается двух уже-pending promises (RPC резолвится один раз — JS
  // promises memoized).
  const contentBlocks = (row.content as unknown as KbBlock[]) ?? [];
  const { slugs: mentionSlugs } = extractBacklinks(contentBlocks);

  // Консолидированный путь — kb_get_page_view_data RPC (миграция 108)
  // объединяет 4 query (favorited + read-status (3 internal!) +
  // breadcrumbs + backlinks) в один round-trip. Pool footprint per
  // page-nav: 6+ → 1 для view-data. Promise.all ужался с 10 до 7 promises.
  //
  // getCachedPermissions / getCachedActiveAccountId — React cache() обёртки:
  // layout уже вызвал эти RPC, дочерняя страница получает тот же результат
  // без повторного DB-хита (деduplication в рамках одного RSC-дерева).
  //
  // История: первая попытка (#163) откатывалась #164 в подозрении на
  // регрессию, но реальная регрессия (incident 2026-05-07) была в
  // kb_threads write-back loop (см. миграцию 109). К RPC отношения не
  // имела. После фиксов loop'а возврат к consolidated пути безопасен.
  const [
    permissionCodes,
    activeAccountId,
    { data: pageViewData },
    { rows: allPages },
    { data: profiles },
    mentionResolution,
    aiSlashEnabledResolved,
  ] = await Promise.all([
    getCachedPermissions(),
    getCachedActiveAccountId(),
    getKbPageViewData(row.id),
    getKbTreeRows(),
    profileIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, first_name, last_name, avatar_url")
          .in("id", profileIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }[] }),
    resolveKbMentionTargets(mentionSlugs),
    (async () => {
      const [perms, accId] = await Promise.all([
        getCachedPermissions(),
        getCachedActiveAccountId(),
      ]);
      if (!new Set(perms).has("kb.use_ai") || !accId) return false;
      const { data: accountRow } = await supabase
        .from("accounts")
        .select("ai_enabled")
        .eq("id", accId)
        .maybeSingle();
      return Boolean(accountRow?.ai_enabled);
    })(),
  ]);

  // Деструктурируем pageViewData в shape совместимый со старым downstream
  // кодом (banner / menu / breadcrumb компоненты не меняются). Если RPC
  // упал — fallback safe defaults; getKbPageBySlug выше бы redirect'нул
  // на notFound() если бы row была недоступна, поэтому failure тут —
  // редкий edge-case (timeout / DB error).
  const favorited = pageViewData?.favorited ?? false;
  const readStatus = {
    required: pageViewData?.required_reading ?? false,
    myReadAt: pageViewData?.my_read_at ?? null,
    needsReread: pageViewData?.needs_reread ?? false,
  };
  const chain = pageViewData?.breadcrumbs ?? [];
  const backlinkRows = pageViewData?.backlinks ?? [];
  const permissions = new Set(permissionCodes);
  const hasEditAny = permissions.has("kb.edit_any_page");
  const hasEditOwn = permissions.has("kb.edit_own_pages");
  const hasDelete = permissions.has("kb.delete_pages");
  const hasCreate = permissions.has("kb.create_pages");
  const hasExport = permissions.has("kb.export_pages");
  const hasImportPages = permissions.has("kb.import_pages");
  const hasManageTemplates = permissions.has("kb.manage_templates");
  const hasUseAi = permissions.has("kb.use_ai");
  const hasComment = permissions.has("kb.comment_pages");
  const hasManageRequiredReading = permissions.has("kb.manage_required_reading");
  const hasLockPages = permissions.has("kb.lock_pages");
  const hasViewAnalytics = permissions.has("kb.view_analytics");

  // Базовая edit-permission. Lock-state ограничивает её отдельно ниже:
  // canEditEffective = canEdit && (!locked || canLock).
  const canEditBase =
    hasEditAny ||
    (hasEditOwn && row.created_by === currentUserId);
  const canDelete = hasDelete;
  const canDuplicate = hasCreate;
  const canExport = hasExport;
  // KB-import — отдельный permission `kb.import_pages` (миграция 069),
  // НЕ совпадает с create_pages: в дефолтной матрице у hostess/waiter
  // есть create, но НЕ import (см. import.ts gate, kb-tree-nav.tsx —
  // там Import тоже скрывается отдельно). Без отдельного gate'а юзер
  // видел бы пункт «Импорт» в меню и упирался бы только в server-error
  // (Codex P2 на PR #111).
  const canImport = hasImportPages;
  const canManageTemplates = hasManageTemplates;
  const canManageRequiredReading = hasManageRequiredReading;
  const canLock = hasLockPages;
  const canViewAnalytics = hasViewAnalytics;

  // Effective edit-permission: если страница глобально заблокирована —
  // editor открывается read-only, но юзер с edit-правом может включить
  // локальный Notion-style режим «Редактировать» без записи в БД.
  // KbPageEditor + KbPageMenu принимают `canEditBase` + `initialLocked`
  // отдельно и считают effective сами через page-state-overrides-store.
  const isLocked = row.locked_at !== null;

  // AI slash-команды: двойной gate. UI-уровень — чтобы не показывать
  // /ai-айтемы в slash-меню если account отключил AI или у юзера
  // нет права. Server-action runKbAiCommand перепроверит.
  // Резолв ai_enabled параллелен с основным Promise.all выше (см. inline
  // IIFE) — раньше это был отдельный последовательный roundtrip.
  // hasUseAi проверка дублируется внутри IIFE; финальный gate здесь
  // тоже учитывает hasUseAi на случай если в будущем IIFE поменяет
  // семантику.
  const aiSlashEnabled = hasUseAi && Boolean(aiSlashEnabledResolved);
  // Total descendants — нужно для текста подтверждения удаления
  // (cascade soft-delete заберёт всю ветку, не только direct children).
  const descendantsCount = countDescendants(allPages, row.id);

  // Резолвим, какие kbPageMention chip'ы в текущем content ведут на
  // удалённые страницы — они рендерятся как disabled chip'ы (страница
  // в корзине / hard-delete / импорт из чужого аккаунта). Без этого
  // admin'ы с kb.delete_pages могли клик'нуть на chip и попасть в
  // notFound() (после фильтра deleted_at в getKbPageBySlug).
  //
  // Передаём ОБА множества (`checked` + `deleted`), а не просто
  // «живых». Render-логика негативная: chip перечёркивается ТОЛЬКО
  // когда его slug есть в `deleted`. Slug, отсутствующий в `checked`
  // (= свежевставленный пользователем через `@`-меню уже после
  // SSR-фетча — тогда содержимое row.content его ещё не содержало),
  // считается доступным по умолчанию. Иначе только что добавленный
  // mention автоматически рендерился бы как deleted (Codex bug
  // #100-followup).
  // contentBlocks + mentionSlugs уже посчитаны выше до Promise.all,
  // resolveKbMentionTargets резолвит параллельно с остальными запросами.
  // properties — zod-валидация чтобы кривые/старые записи не сломали
  // UI; невалидные просто отдаём как пустой массив.
  const propertiesParsed = kbPropertiesSchema.safeParse(
    (row as unknown as { properties?: unknown }).properties ?? [],
  );
  const initialProperties: KbProperty[] = propertiesParsed.success
    ? propertiesParsed.data
    : [];
  const { checked: checkedMentionSlugs, deleted: deletedMentionSlugs } =
    mentionResolution;

  // Resolve back-link target: parent page if any, else /knowledge.
  // chain comes root → leaf, last entry is the current page itself.
  const parent = chain.length >= 2 ? chain[chain.length - 2] : null;
  const backHref = parent ? `/knowledge/${parent.slug}` : "/knowledge";
  const backLabel = parent
    ? parent.title || "Без названия"
    : "База знаний";

  // Profile lookup для KbPageMenu — footer + «О странице» dialog
  // (full audit info: id / created / author / updated / editor) +
  // currentUserProfile для аватарки в comment-композере.
  type ProfileEntry = { name: string; avatarUrl: string | null };
  const profilesById = new Map<string, ProfileEntry>();
  for (const p of profiles ?? []) {
    const parts = [p.first_name, p.last_name].filter(Boolean) as string[];
    profilesById.set(p.id, {
      name: parts.length > 0 ? parts.join(" ") : "—",
      avatarUrl: p.avatar_url ?? null,
    });
  }
  const createdByEntry = row.created_by
    ? profilesById.get(row.created_by) ?? null
    : null;
  const createdByName = createdByEntry?.name ?? null;
  const createdByAvatarUrl = createdByEntry?.avatarUrl ?? null;
  const updatedByEntry = row.updated_by
    ? profilesById.get(row.updated_by) ?? null
    : lastEditorId
      ? profilesById.get(lastEditorId) ?? null
      : null;
  const updatedByName = updatedByEntry?.name ?? null;

  // Current user — для аватарки и имени в comment-композере.
  const currentUserProfile = currentUserId
    ? profilesById.get(currentUserId) ?? null
    : null;

  return (
    <div className="flex-1 flex flex-col">
      {/* Top-bar slots (теперь отрисовываются в KB-собственном header'е,
          см. knowledge/layout.tsx). Левая часть — breadcrumb back-link,
          правая — version history, delete, info popover. */}
      <PageBreadcrumb>
        <KbBackLink href={backHref} label={backLabel} />
      </PageBreadcrumb>
      <PageHeaderActions>
        {/* Notion-style ⋯-меню: все page-level действия (избранное,
         *  required-reading, lock, undo/redo, дублировать, экспорт,
         *  импорт, аналитика, история версий, удалить) свернуты в один
         *  dropdown. Дизайн: sheerly.pen frame 09 · DOgqX. */}
        <KbPageMenu
          pageId={row.id}
          pageSlug={row.slug}
          pageTitle={row.title}
          childCount={descendantsCount}
          initialShowChildren={row.show_children !== false}
          initialFavorited={favorited}
          initialRequiredReading={readStatus.required}
          initialLocked={isLocked}
          updatedAt={row.updated_at}
          updatedByName={updatedByName}
          canEditBase={canEditBase}
          canDelete={canDelete}
          canDuplicate={canDuplicate}
          canExport={canExport}
          canImport={canImport}
          canManageTemplates={canManageTemplates}
          canManageRequiredReading={canManageRequiredReading}
          canLock={canLock}
          canViewAnalytics={canViewAnalytics}
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
            initialProperties={initialProperties}
            checkedMentionSlugs={checkedMentionSlugs}
            deletedMentionSlugs={deletedMentionSlugs}
            canEditBase={canEditBase}
            initialLocked={isLocked}
            canLock={canLock}
            canCreate={hasCreate}
            aiSlashEnabled={aiSlashEnabled}
            canComment={hasComment}
            accountId={activeAccountId}
            userId={currentUserId}
            currentUserName={currentUserProfile?.name ?? null}
            currentUserAvatarUrl={currentUserProfile?.avatarUrl ?? null}
            authorName={createdByName}
            authorAvatarUrl={createdByAvatarUrl}
            readingMinutes={
              row.plain_text && row.plain_text.trim().length > 0
                ? estimateReadingMinutes(row.plain_text)
                : null
            }
          />

          <KbChildrenList
            pageId={row.id}
            allPages={allPages}
            initialVisible={row.show_children !== false}
          />
          <KbBacklinks rows={backlinkRows} />
        </div>
      </div>
    </div>
  );
}

/**
 * Read-only просмотр soft-deleted страницы (Notion-style: страница в
 * корзине не 404-ит). Намеренно НЕ тянет view-data / tree / mentions /
 * required-reading / backlinks — это корзинная страница, аналитику
 * просмотра по ней не пишем (KbPageEditor без userId → не трекает),
 * меню действий заменено баннером «в корзине».
 */
async function DeletedKbPageView({ row }: { row: KbPageRow }) {
  const supabase = await createClient();
  const [permissionCodes, descRes, deletedByRes] = await Promise.all([
    getCachedPermissions(),
    supabase
      .from("kb_pages")
      .select("id", { count: "exact", head: true })
      .eq("deleted_root_id", row.id)
      .neq("id", row.id),
    row.deleted_by
      ? supabase
          .from("profiles")
          .select("first_name, last_name")
          .eq("id", row.deleted_by)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const canManage = new Set(permissionCodes).has("kb.delete_pages");
  const descendantsCount = descRes.count ?? 0;
  const deletedByProfile = deletedByRes.data as {
    first_name: string | null;
    last_name: string | null;
  } | null;
  const deletedByName = deletedByProfile
    ? [deletedByProfile.first_name, deletedByProfile.last_name]
        .filter(Boolean)
        .join(" ") || null
    : null;

  const contentBlocks = (row.content as unknown as KbBlock[]) ?? [];
  const propsParsed = kbPropertiesSchema.safeParse(
    (row as unknown as { properties?: unknown }).properties ?? [],
  );
  const initialProperties: KbProperty[] = propsParsed.success
    ? propsParsed.data
    : [];

  return (
    <div className="flex-1 flex flex-col">
      <PageBreadcrumb>
        <KbBackLink href="/knowledge/trash" label="Корзина" />
      </PageBreadcrumb>

      <div className="px-6 md:px-8 pt-6 pb-8 w-full flex flex-col gap-3">
        <div className="mx-auto w-full max-w-[760px] flex flex-col gap-6">
          <KbDeletedPageBanner
            pageId={row.id}
            pageSlug={row.slug}
            title={row.title}
            deletedAt={row.deleted_at}
            deletedByName={deletedByName}
            descendantsCount={descendantsCount}
            canManage={canManage}
          />
          <KbPageEditor
            key={`${row.id}-deleted`}
            pageId={row.id}
            initialTitle={row.title}
            initialIcon={row.icon}
            initialIconColor={row.icon_color}
            initialContent={contentBlocks}
            initialProperties={initialProperties}
            canEditBase={false}
            initialLocked={row.locked_at !== null}
          />
        </div>
      </div>
    </div>
  );
}

/** Recursive descendants count via in-memory walk (cheap on KB scale). */
function countDescendants(allPages: KbPageTreeRow[], rootId: string): number {
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
