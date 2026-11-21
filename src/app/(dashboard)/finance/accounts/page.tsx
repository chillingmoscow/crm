import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { listAccountVenues, listLegalEntities } from "@/lib/org/legal-entities";
import { listBankAccountGroups, listBankAccounts } from "@/lib/finance/bank-accounts";
import { getActiveFinanceLegalEntityId } from "@/lib/finance/active-legal-entity";
import { getActiveAccountAmountRoundingScale } from "@/lib/settings/account";
import { AccountsList } from "./_components/accounts-list";

export const metadata: Metadata = { title: "Счета и кассы" };

export default async function BankAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string; archive?: string }>;
}) {
  const can = await getCachedPermissionChecker();
  if (!can("finance.view_bank_accounts")) redirect("/dashboard");
  const canManage = Boolean(can("finance.manage_bank_accounts"));

  const [supabase, activeAccountId] = await Promise.all([createClient(), getCachedActiveAccountId()]);
  // Архив, возврат и удаление проверяют владельца на сервере
  // (assertBankAccountOwner) — архив в списке показываем только ему.
  const { data: isOwner } = activeAccountId
    ? await supabase.rpc("is_account_owner", { p_account_id: activeAccountId })
    : { data: false };

  // Юрлицо из переключателя раздела «Финансы» включает фильтр «Юрлицо» сразу;
  // сам список грузится целиком, чтобы фильтр можно было снять на месте.
  const [
    { rows: accounts },
    { rows: groups },
    { rows: legalEntities },
    { rows: venues },
    activeLegalEntityId,
    amountRoundingScale,
    params,
  ] = await Promise.all([
    listBankAccounts({ include_deleted: Boolean(isOwner) }),
    listBankAccountGroups(),
    listLegalEntities(),
    listAccountVenues({ liveOnly: true }),
    getActiveFinanceLegalEntityId(),
    getActiveAccountAmountRoundingScale(),
    searchParams,
  ]);

  return (
    <AccountsList
      accounts={accounts}
      groups={groups}
      legalEntities={legalEntities.map((le) => ({ id: le.id, name: le.name, short_name: le.short_name }))}
      venues={venues.map((v) => ({ id: v.id, name: v.name }))}
      canManage={canManage}
      canViewTransactions={Boolean(can("finance.view_transactions"))}
      isOwner={Boolean(isOwner)}
      canHardDelete={Boolean(can("finance.delete_bank_account"))}
      initialLegalEntityId={activeLegalEntityId}
      openCreate={params.create === "1"}
      openArchive={params.archive === "1"}
      amountRoundingScale={amountRoundingScale}
    />
  );
}
