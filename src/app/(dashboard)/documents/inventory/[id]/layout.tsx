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
  processed: boolean;
  results_has_line_amounts: boolean;
  assigned_to: string | null;
  store_id: string | null;
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
      "id, account_id, document_number, status, processed, results_has_line_amounts, assigned_to, store_id",
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
  ] = await Promise.all([
    getCachedUser(),
    getCachedActiveAccountId(),
    supabase.rpc("has_permission", { permission_code: "inventory.view_documents" }),
    supabase.rpc("has_permission", { permission_code: "inventory.fill_assigned_documents" }),
    supabase.rpc("has_permission", { permission_code: "inventory.view_results" }),
    supabase.rpc("has_permission", { permission_code: "inventory.manage_documents" }),
  ]);

  if (!user) redirect("/login");
  if (!accountId) redirect("/dashboard");

  const document = await getCachedInventoryDocumentBasics(id, accountId as string);
  if (!document) notFound();

  const isAssignedToMe = document.assigned_to === user.id;
  const canSeeAct = canView || canViewResults || (canFill && isAssignedToMe);
  if (!canSeeAct) redirect("/documents/inventory");

  const storeTitle = document.store_id ? await getCachedStoreTitle(document.store_id) : null;

  const showFillingTab = Boolean(canView) || (Boolean(canFill) && isAssignedToMe);
  const showResultsTab = Boolean(canViewResults);

  // ready_for_review: workflow завершён заполнителем, ожидает менеджера —
  // итоги уже посчитаны Quick Resto, ему есть на что посмотреть перед
  // финализацией. results_blocked — итоги нужны для разбора.
  const resultsAvailable =
    document.processed ||
    document.results_has_line_amounts ||
    document.status === "results_blocked" ||
    document.status === "ready_for_review";

  return (
    <div className="flex w-full flex-1 flex-col">
      <DocumentActHeader
        documentId={document.id}
        documentNumber={document.document_number}
        status={document.status}
        storeTitle={storeTitle}
        canFill={showFillingTab}
        canViewResults={showResultsTab}
        canManage={Boolean(canManage)}
        resultsAvailable={resultsAvailable}
      />
      {children}
    </div>
  );
}
