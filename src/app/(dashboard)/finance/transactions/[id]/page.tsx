import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { listLegalEntities, listAccountVenues } from "@/lib/org/legal-entities";
import { listBankAccounts } from "@/lib/finance/bank-accounts";
import { listFinanceCategories } from "@/lib/finance/categories";
import { listCounterparties } from "@/lib/finance/counterparties";
import { getTransaction } from "@/lib/finance/transactions";
import { listTransactionAttachments } from "@/lib/files/attachments";
import { TransactionDetail } from "./_components/transaction-detail";

const ATTACHMENT_DOC_TYPE_LABELS: Record<string, string> = {
  receipt:          "Чек",
  contract:         "Договор",
  act:              "Акт",
  invoice:          "Счёт",
  waybill:          "Накладная",
  tax_document:     "Налоговый документ",
  registration_doc: "Учредительный",
  other:            "Прочее",
};

export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Permissions resolved up front so child gates align with RLS that
  // will fire on click. Edit ownership rule mirrors RLS migration 042
  // §transactions_update: own row + update_transaction OR
  // update_any_transaction. Soft-delete + restore both gate on
  // delete_transaction (the only finance.delete_* permission for
  // transactions).
  const [
    { data: canView },
    { data: canUpdateOwn },
    { data: canUpdateAny },
    { data: canDelete },
    { data: canUploadAttachments },
    { data: canDeleteAttachments },
    { data: { user } },
  ] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "finance.view_transactions" }),
    supabase.rpc("has_permission", { permission_code: "finance.update_transaction" }),
    supabase.rpc("has_permission", { permission_code: "finance.update_any_transaction" }),
    supabase.rpc("has_permission", { permission_code: "finance.delete_transaction" }),
    supabase.rpc("has_permission", { permission_code: "finance.upload_attachments" }),
    supabase.rpc("has_permission", { permission_code: "finance.delete_attachments" }),
    supabase.auth.getUser(),
  ]);
  if (!canView) redirect("/dashboard");

  const { row, error } = await getTransaction(id);
  if (error || !row) redirect("/finance/transactions");

  const isOwner = !!user && row.created_by === user.id;
  const canEdit = !row.deleted_at && (
    isOwner ? !!canUpdateOwn || !!canUpdateAny : !!canUpdateAny
  );

  const [
    { rows: legalEntities },
    { rows: venues },
    { rows: bankAccounts },
    { rows: categories },
    { rows: counterparties },
    { rows: attachmentRows },
  ] = await Promise.all([
    listLegalEntities(),
    listAccountVenues(),
    // Soft-deleted bank accounts may still be referenced by historical
    // transactions — include them so the cell renders the name instead
    // of "—" for an old expense.
    listBankAccounts({ include_deleted: true }),
    listFinanceCategories({ include_inactive: true }),
    listCounterparties({ include_deleted: true }),
    listTransactionAttachments(id),
  ]);

  const attachments = attachmentRows.map((att) => ({
    fileId:     att.file.id,
    name:       att.file.name,
    mime_type:  att.file.mime_type,
    size_bytes: att.file.size_bytes,
    document_type_label:
      ATTACHMENT_DOC_TYPE_LABELS[att.document_type] ?? att.document_type,
  }));

  return (
    <div className="p-6 md:p-8 w-full max-w-4xl">
      <Link
        href="/finance/transactions"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        К списку транзакций
      </Link>

      <TransactionDetail
        row={row}
        legalEntities={legalEntities}
        venues={venues}
        bankAccounts={bankAccounts}
        categories={categories}
        counterparties={counterparties}
        attachments={attachments}
        canEdit={canEdit}
        canDelete={!!canDelete}
        canUploadAttachments={!!canUploadAttachments}
        canDeleteAttachments={!!canDeleteAttachments}
      />
    </div>
  );
}
