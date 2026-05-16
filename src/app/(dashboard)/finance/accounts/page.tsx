import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { listLegalEntities } from "@/lib/org/legal-entities";
import {
  listBankAccountGroups,
  listBankAccounts,
} from "@/lib/finance/bank-accounts";
import { getActiveFinanceLegalEntityId } from "@/lib/finance/active-legal-entity";
import { getActiveAccountAmountRoundingScale } from "@/lib/settings/account";
import { AccountsList } from "./_components/accounts-list";

export default async function BankAccountsPage() {
  const supabase = await createClient();

  const [{ data: canView }, { data: canManage }] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "finance.view_bank_accounts" }),
    supabase.rpc("has_permission", { permission_code: "finance.manage_bank_accounts" }),
  ]);
  if (!canView) redirect("/dashboard");

  // Honour the LegalEntitySwitcher cookie so users who have
  // view_all_legal_entities can scope the list to one LE; for
  // ordinary users RLS already scopes to active venue's default LE,
  // the filter is just a sub-set there.
  // Soft-deleted rows gated server-side on canManage so the RSC payload
  // doesn't leak removed accounts to view-only users (PR #15 lesson).
  // The relaxed SELECT policy from migration 046 is what makes the
  // include_deleted flag actually return rows — before that the SELECT
  // policy filtered them unconditionally.
  const activeLegalEntityId = await getActiveFinanceLegalEntityId();
  const [{ rows: accounts }, { rows: groups }, { rows: legalEntities }, amountRoundingScale] =
    await Promise.all([
      listBankAccounts({
        include_deleted: !!canManage,
        legal_entity_id: activeLegalEntityId ?? undefined,
      }),
      listBankAccountGroups(),
      listLegalEntities(),
      getActiveAccountAmountRoundingScale(),
    ]);

  const legalEntityNames: Record<string, string> = {};
  for (const le of legalEntities) {
    legalEntityNames[le.id] = le.short_name ?? le.name;
  }

  return (
    <AccountsList
      accounts={accounts}
      groups={groups}
      legalEntityNames={legalEntityNames}
      canManage={!!canManage}
      amountRoundingScale={amountRoundingScale}
    />
  );
}
