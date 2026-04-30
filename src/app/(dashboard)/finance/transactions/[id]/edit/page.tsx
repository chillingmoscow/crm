import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { listLegalEntities, listAccountVenues } from "@/lib/org/legal-entities";
import { listBankAccounts } from "@/lib/finance/bank-accounts";
import { listFinanceCategories } from "@/lib/finance/categories";
import { listCounterparties } from "@/lib/finance/counterparties";
import { getTransaction } from "@/lib/finance/transactions";
import { TransactionForm } from "../../_components/transaction-form";

export default async function EditTransactionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: canView },
    { data: canUpdateOwn },
    { data: canUpdateAny },
    { data: { user } },
  ] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "finance.view_transactions" }),
    supabase.rpc("has_permission", { permission_code: "finance.update_transaction" }),
    supabase.rpc("has_permission", { permission_code: "finance.update_any_transaction" }),
    supabase.auth.getUser(),
  ]);
  if (!canView) redirect("/dashboard");

  const { row } = await getTransaction(id);
  if (!row) redirect("/finance/transactions");

  // Edit ownership matches RLS migration 042 §transactions_update:
  //   own row + update_transaction OR update_any_transaction.
  const isOwner = !!user && row.created_by === user.id;
  const canEdit = isOwner ? !!canUpdateOwn || !!canUpdateAny : !!canUpdateAny;
  if (!canEdit) redirect(`/finance/transactions/${id}`);

  // Soft-deleted transactions can't be edited — restore first. UI for
  // restore lands in 4.5c; for now just redirect back.
  if (row.deleted_at) redirect(`/finance/transactions/${id}`);

  // Lookup arrays — include soft-deleted/inactive so the existing
  // values render. Editing them swaps the soft-deleted reference for
  // an active one, which is fine.
  const [
    { rows: legalEntities },
    { rows: venues },
    { rows: bankAccounts },
    { rows: categories },
    { rows: counterparties },
  ] = await Promise.all([
    listLegalEntities(),
    listAccountVenues(),
    listBankAccounts({ include_deleted: true }),
    listFinanceCategories({ include_inactive: true }),
    listCounterparties({ include_deleted: true }),
  ]);

  return (
    <div className="p-6 md:p-8 w-full max-w-3xl">
      <Link
        href={`/finance/transactions/${id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Назад
      </Link>

      <h1 className="text-2xl font-semibold mb-1">Редактирование транзакции</h1>
      <p className="text-muted-foreground text-sm mb-6">
        #{row.public_id} — изменения обновят балансы счетов автоматически.
      </p>

      <TransactionForm
        mode="edit"
        transactionId={id}
        initial={row}
        legalEntities={legalEntities}
        venues={venues}
        bankAccounts={bankAccounts}
        categories={categories}
        counterparties={counterparties}
      />
    </div>
  );
}
