import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { listLegalEntities, listAccountVenues } from "@/lib/org/legal-entities";
import { listBankAccountGroups } from "@/lib/finance/bank-accounts";
import { BankAccountForm } from "../_components/bank-account-form";

export default async function NewBankAccountPage() {
  const supabase = await createClient();
  const { data: canManage } = await supabase.rpc("has_permission", {
    permission_code: "finance.manage_bank_accounts",
  });
  if (!canManage) redirect("/finance/accounts");

  const [{ rows: legalEntities }, { rows: venues }, { rows: groups }] =
    await Promise.all([
      listLegalEntities(),
      listAccountVenues(),
      listBankAccountGroups(),
    ]);

  return (
    <div className="p-6 md:p-8 w-full max-w-4xl">
      <Link
        href="/finance/accounts"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        К списку счетов
      </Link>

      <h1 className="text-2xl font-semibold mb-1">Новый счёт</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Баланс пересчитывается автоматически при создании транзакций — здесь его задать нельзя
      </p>

      <BankAccountForm
        mode="create"
        legalEntities={legalEntities}
        venues={venues}
        groups={groups}
      />
    </div>
  );
}
