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
};

/**
 * Per-request кеш на базовые поля акта. Layout и дочерние page.tsx
 * оба вызывают этот loader; React.cache гарантирует один реальный
 * запрос к БД на render-pass.
 */
export const getCachedInventoryDocumentBasics = cache(async (id: string, accountId: string) => {
  const admin = asLooseDb(createAdminClient());
  const { data, error } = await admin
    .from<DocumentBasicsRow>("documents")
    .select("id, account_id, document_number, status, processed, results_has_line_amounts, assigned_to")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) return null;
  return data ?? null;
});

/**
 * Общий layout страниц одного акта инвентаризации:
 * `/documents/inventory/[id]` (Заполнение) и
 * `/documents/inventory/[id]/results` (Итоги).
 *
 * Загружает базовые поля акта + проверяет permissions, рендерит
 * shared-шапку с табами. Дочерние page.tsx делают свою конкретную
 * работу (фетч позиций / итогов / событий).
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
  ] = await Promise.all([
    getCachedUser(),
    getCachedActiveAccountId(),
    supabase.rpc("has_permission", { permission_code: "inventory.view_documents" }),
    supabase.rpc("has_permission", { permission_code: "inventory.fill_assigned_documents" }),
    supabase.rpc("has_permission", { permission_code: "inventory.view_results" }),
  ]);

  if (!user) redirect("/login");
  if (!accountId) redirect("/dashboard");

  const document = await getCachedInventoryDocumentBasics(id, accountId as string);
  if (!document) notFound();

  // Доступ к самому акту:
  // - canView: видит любой акт аккаунта,
  // - canFill + assigned_to = self: видит только свой,
  // - canViewResults: тоже видит для просмотра итогов.
  // Кто-то из этого должен быть true.
  const isAssignedToMe = document.assigned_to === user.id;
  const canSeeAct = canView || canViewResults || (canFill && isAssignedToMe);
  if (!canSeeAct) redirect("/documents/inventory");

  // Видимость табов в шапке:
  // - «Заполнение»: canFill && assigned_to=me, ИЛИ canView (менеджер).
  // - «Итоги»: canViewResults.
  const showFillingTab = Boolean(canView) || (Boolean(canFill) && isAssignedToMe);
  const showResultsTab = Boolean(canViewResults);

  const resultsAvailable =
    document.processed ||
    document.results_has_line_amounts ||
    document.status === "results_blocked";

  return (
    <div className="flex w-full flex-1 flex-col">
      <DocumentActHeader
        documentId={document.id}
        documentNumber={document.document_number}
        status={document.status}
        canFill={showFillingTab}
        canViewResults={showResultsTab}
        resultsAvailable={resultsAvailable}
      />
      {children}
    </div>
  );
}
