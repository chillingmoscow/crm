import { notFound, redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCachedActiveAccountId,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";

import { getCachedStoreTitle } from "../layout";
import { ActCommentEditor } from "../_components/act-comment-editor";

type DocumentOverviewRow = {
  id: string;
  document_number: string;
  status: string;
  note: string | null;
  comment: string | null;
  invoice_date: string | null;
  last_qr_update_date: string | null;
  assigned_to: string | null;
  reviewer_id: string | null;
  store_id: string | null;
  archived_at: string | null;
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value ?? "—"}</span>
    </div>
  );
}

/**
 * Таб «Основное» страницы акта. Базовая сводка + общий комментарий к акту
 * (локальное поле documents.note, не из Quick Resto). Доступ к самой странице
 * уже отфильтрован layout'ом; здесь только право РЕДАКТИРОВАТЬ комментарий.
 */
export default async function InventoryDocumentOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [user, accountId, can] = await Promise.all([
    getCachedUser(),
    getCachedActiveAccountId(),
    getCachedPermissionChecker(),
  ]);
  const canManage = can("inventory.manage_documents");
  const canRecount = can("inventory.recount_documents");
  if (!user) redirect("/login");
  if (!accountId) redirect("/dashboard");

  const admin = asLooseDb(createAdminClient());
  const { data: document } = await admin
    .from<DocumentOverviewRow>("documents")
    .select(
      "id, document_number, status, note, comment, invoice_date, last_qr_update_date, assigned_to, reviewer_id, store_id, archived_at",
    )
    .eq("id", id)
    .eq("account_id", accountId as string)
    .maybeSingle();
  if (!document) notFound();

  const storeTitle = document.store_id ? await getCachedStoreTitle(document.store_id) : null;
  const canEdit =
    !document.archived_at &&
    (Boolean(canManage) ||
      document.assigned_to === user.id ||
      (document.reviewer_id === user.id && Boolean(canRecount)));

  const formatDate = (value: string | null) =>
    value ? new Date(value).toLocaleDateString("ru-RU") : "—";

  return (
    <div className="mx-auto w-full max-w-[920px] px-3 pb-10 md:px-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Field label="Склад" value={storeTitle} />
        <Field label="Дата акта" value={formatDate(document.invoice_date)} />
        <Field label="Обновлён в Quick Resto" value={formatDate(document.last_qr_update_date)} />
      </div>

      {document.comment?.trim() ? (
        <div className="mt-6">
          <div className="mb-1 text-sm font-medium">Комментарий из Quick Resto</div>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{document.comment}</p>
        </div>
      ) : null}

      <div className="mt-6">
        <div className="mb-1 text-sm font-medium">Комментарий к акту</div>
        <p className="mb-2 text-xs text-muted-foreground">
          Локальная заметка для команды. Не уходит в Quick Resto и не
          перезатирается синхронизацией.
        </p>
        <ActCommentEditor documentId={document.id} note={document.note} canEdit={canEdit} />
      </div>
    </div>
  );
}
