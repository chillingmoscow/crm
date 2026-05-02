import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { listLegalEntities, listAccountVenues } from "@/lib/org/legal-entities";
import { listBankAccounts, listBankAccountGroups } from "@/lib/finance/bank-accounts";
import {
  listFinanceCategories,
  listFinanceCategoryGroups,
} from "@/lib/finance/categories";
import {
  listCounterparties,
  listCounterpartyGroups,
} from "@/lib/finance/counterparties";
import { listTransactions } from "@/lib/finance/transactions";
import { getActiveFinanceLegalEntityId } from "@/lib/finance/active-legal-entity";

import { TransactionsPage } from "./_components/transactions-page";

/**
 * Server entry for /finance/transactions.
 *
 * Permission contract:
 * - finance.view_transactions to enter the page (otherwise redirect to /dashboard).
 * - finance.create_transaction to show the «+ Добавить операцию» button.
 * - finance.delete_transaction to show the bulk-delete action and the
 *   delete button inside the edit drawer.
 * - finance.export to show the export-CSV icon.
 *
 * Data is loaded once on the server (initial 200 rows + reference lists)
 * and handed to a single client component which keeps all UI state —
 * filters, selection, drawer-form open/close — in memory. Mutations go
 * through the server actions in src/lib/finance/* and trigger a
 * router.refresh() to repaint the list with the latest server state.
 */
export default async function TransactionsServerPage() {
  const supabase = await createClient();

  const [
    { data: canView },
    { data: canCreate },
    { data: canDelete },
    { data: canExport },
  ] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "finance.view_transactions" }),
    supabase.rpc("has_permission", { permission_code: "finance.create_transaction" }),
    supabase.rpc("has_permission", { permission_code: "finance.delete_transaction" }),
    supabase.rpc("has_permission", { permission_code: "finance.export" }),
  ]);

  if (!canView) redirect("/dashboard");

  const cookieLegalEntityId = await getActiveFinanceLegalEntityId();

  const [
    txResult,
    { rows: legalEntities },
    { rows: venues },
    { rows: bankAccounts },
    { rows: bankAccountGroups },
    { rows: categories },
    { rows: categoryGroups },
    { rows: counterparties },
    { rows: counterpartyGroups },
  ] = await Promise.all([
    listTransactions({
      filters: { legal_entity_id: cookieLegalEntityId ?? undefined },
      page: 1,
      pageSize: 200,
    }),
    listLegalEntities(),
    listAccountVenues(),
    listBankAccounts({ include_deleted: false }),
    listBankAccountGroups(),
    listFinanceCategories({ include_inactive: false }),
    listFinanceCategoryGroups(),
    listCounterparties({ include_deleted: false }),
    listCounterpartyGroups(),
  ]);

  return (
    <TransactionsPage
      initialTransactions={txResult.rows}
      initialTotal={txResult.total}
      activeLegalEntityIdFromCookie={cookieLegalEntityId}
      legalEntities={legalEntities}
      venues={venues}
      bankAccounts={bankAccounts}
      bankAccountGroups={bankAccountGroups}
      categories={categories}
      categoryGroups={categoryGroups}
      counterparties={counterparties}
      counterpartyGroups={counterpartyGroups}
      canCreate={!!canCreate}
      canDelete={!!canDelete}
      canExport={!!canExport}
    />
  );
}
