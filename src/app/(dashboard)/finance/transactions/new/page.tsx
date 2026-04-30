import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { listLegalEntities, listAccountVenues } from "@/lib/org/legal-entities";
import { listBankAccounts } from "@/lib/finance/bank-accounts";
import { listFinanceCategories } from "@/lib/finance/categories";
import { listCounterparties } from "@/lib/finance/counterparties";
import { TransactionForm } from "../_components/transaction-form";

export default async function NewTransactionPage() {
  const supabase = await createClient();
  const { data: canCreate } = await supabase.rpc("has_permission", {
    permission_code: "finance.create_transaction",
  });
  if (!canCreate) redirect("/finance/transactions");

  const [
    { rows: legalEntities },
    { rows: venues },
    { rows: bankAccounts },
    { rows: categories },
    { rows: counterparties },
  ] = await Promise.all([
    listLegalEntities(),
    listAccountVenues(),
    listBankAccounts({ include_deleted: false }),
    listFinanceCategories({ include_inactive: false }),
    listCounterparties({ include_deleted: false }),
  ]);

  return (
    <div className="p-6 md:p-8 w-full max-w-3xl">
      <Link
        href="/finance/transactions"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        К списку транзакций
      </Link>

      <h1 className="text-2xl font-semibold mb-1">Новая транзакция</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Доход или расход — поля статьи и контрагента, перевод — счёт и юрлицо получателя.
      </p>

      <TransactionForm
        mode="create"
        legalEntities={legalEntities}
        venues={venues}
        bankAccounts={bankAccounts}
        categories={categories}
        counterparties={counterparties}
      />
    </div>
  );
}
