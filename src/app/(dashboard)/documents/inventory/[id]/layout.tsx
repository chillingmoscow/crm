import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, getCachedActiveAccountId, getCachedUser } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";

import { DocumentActHeader } from "./_components/document-act-header";

type DocumentBasicsRow = {
  id: string;
  account_id: string;
  document_number: string;
  status: string;
  recount_of_document_id: string | null;
  processed: boolean;
  results_has_line_amounts: boolean;
  assigned_to: string | null;
  reviewer_id: string | null;
  store_id: string | null;
  venue_id: string | null;
  results_reopened_after_processed: boolean;
};

type StoreTitleRow = { title: string };

/**
 * Per-request кеш на базовые поля акта. Layout и дочерние page.tsx
 * оба вызывают этот loader; React.cache гарантирует один реальный
 * запрос к БД на render-pass.
 */
export const getCachedInventoryDocumentBasics = cache(async (id: string, accountId: string) => {
  const admin = asLooseDb(createAdminClient());
  const { data, error } = await admin
    .from<DocumentBasicsRow>("documents")
    .select(
      "id, account_id, document_number, status, processed, results_has_line_amounts, assigned_to, reviewer_id, store_id, venue_id, results_reopened_after_processed, recount_of_document_id",
    )
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) return null;
  return data ?? null;
});

export const getCachedStoreTitle = cache(async (storeId: string) => {
  const admin = asLooseDb(createAdminClient());
  const { data } = await admin
    .from<StoreTitleRow>("stores")
    .select("title")
    .eq("id", storeId)
    .maybeSingle();
  return data?.title ?? null;
});

/**
 * Общий layout страниц одного акта инвентаризации:
 *   /documents/inventory/[id]           — Форма
 *   /documents/inventory/[id]/results   — Итоги
 *   /documents/inventory/[id]/history   — Журнал
 *   /documents/inventory/[id]/danger    — Опасная зона
 *
 * Загружает базовые поля акта + permissions + контекст для шапки
 * (название склада, количество позиций). Дочерние page.tsx делают
 * свою конкретную работу.
 */
export default async function InventoryDocumentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [
    user,
    accountId,
    { data: canView },
    { data: canFill },
    { data: canViewResults },
    { data: canManage },
    { data: canViewAllVenues },
    { data: canManageStores },
    { data: canRecountDocuments },
    { data: activeVenueId },
  ] = await Promise.all([
    getCachedUser(),
    getCachedActiveAccountId(),
    supabase.rpc("has_permission", { permission_code: "inventory.view_documents" }),
    supabase.rpc("has_permission", { permission_code: "inventory.fill_assigned_documents" }),
    supabase.rpc("has_permission", { permission_code: "inventory.view_results" }),
    supabase.rpc("has_permission", { permission_code: "inventory.manage_documents" }),
    supabase.rpc("has_permission", { permission_code: "inventory.view_all_venues" }),
    supabase.rpc("has_permission", { permission_code: "inventory.manage_stores" }),
    supabase.rpc("has_permission", { permission_code: "inventory.recount_documents" }),
    supabase.rpc("get_active_venue_id"),
  ]);

  if (!user) redirect("/login");
  if (!accountId) redirect("/dashboard");

  const document = await getCachedInventoryDocumentBasics(id, accountId as string);
  if (!document) notFound();

  const isAssignedToMe = document.assigned_to === user.id;
  const isReviewerMe = document.reviewer_id === user.id;
  const canSeeAct =
    canView ||
    canViewResults ||
    (canFill && isAssignedToMe) ||
    (Boolean(canRecountDocuments) && isReviewerMe);
  // Venue-scope: зеркало documents_select (миграции 195 + 210). Страницы акта
  // читают через admin-клиент (RLS не применяется), поэтому venue-ограничение
  // дублируем здесь — иначе venue-ограниченный юзер открывает любой акт
  // аккаунта по прямому URL (список через RLS уже скоупится). Ветка
  // проверяющего (reviewer_id + recount_documents) добавлена в 210: назначенный
  // проверяющий видит акт даже в чужом заведении.
  const venueOk =
    Boolean(canViewAllVenues) ||
    (document.venue_id != null && document.venue_id === activeVenueId) ||
    (document.venue_id == null && Boolean(canManageStores)) ||
    (isAssignedToMe && Boolean(canFill)) ||
    (isReviewerMe && Boolean(canRecountDocuments));
  if (!canSeeAct || !venueOk) redirect("/documents/inventory");

  const storeTitle = document.store_id ? await getCachedStoreTitle(document.store_id) : null;

  const showFillingTab = Boolean(canView) || (Boolean(canFill) && isAssignedToMe);
  // Итоги: право view_results ИЛИ назначенный исполнитель — но таб показываем
  // только после ПРОВЕДЕНИЯ акта (в процессе заполнения линейный сотрудник
  // итоги не видит; страница результатов зеркалит это ограничение).
  const showResultsTab =
    Boolean(canViewResults) || (isAssignedToMe && Boolean(canFill) && document.processed);

  // ready_for_review: workflow завершён заполнителем, ожидает менеджера —
  // итоги уже посчитаны Quick Resto, ему есть на что посмотреть перед
  // финализацией. results_blocked — итоги нужны для разбора.
  const resultsAvailable =
    document.processed ||
    document.results_has_line_amounts ||
    document.status === "results_blocked" ||
    document.status === "ready_for_review";

  // Акт пересчёта помечаем в шапке ссылкой на исходный акт.
  const { data: parentDoc } = document.recount_of_document_id
    ? await asLooseDb(createAdminClient())
        .from<{ id: string; document_number: string }>("documents")
        .select("id, document_number")
        .eq("id", document.recount_of_document_id)
        .eq("account_id", document.account_id)
        .maybeSingle()
    : { data: null };
  const recountParent = parentDoc?.id
    ? { id: parentDoc.id, documentNumber: parentDoc.document_number }
    : null;

  return (
    <div className="flex w-full flex-1 flex-col">
      <DocumentActHeader
        documentId={document.id}
        documentNumber={document.document_number}
        status={document.status}
        storeTitle={storeTitle}
        canFill={showFillingTab}
        canViewResults={showResultsTab}
        // Журнал гейтим настоящим view_results: history/page.tsx редиректит без
        // него, а read-only исполнителю (showResultsTab по assigned+processed)
        // журнал не положен — иначе таб «Журнал» отбрасывал бы обратно (Codex P2).
        canViewJournal={Boolean(canViewResults)}
        canManage={Boolean(canManage)}
        resultsAvailable={resultsAvailable}
        reopenedAfterProcessed={document.results_reopened_after_processed}
        recountParent={recountParent}
      />
      {children}
    </div>
  );
}
