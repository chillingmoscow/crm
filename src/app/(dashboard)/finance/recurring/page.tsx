import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { isDadataConfigured } from "@/lib/dadata/client";
import { listBankAccounts } from "@/lib/finance/bank-accounts";
import { listFinanceCategories } from "@/lib/finance/categories";
import { listCounterparties } from "@/lib/finance/counterparties";
import { listRecurringTemplates } from "@/lib/finance/recurring";
import { listAccountVenues } from "@/lib/org/legal-entities";
import {
  getActiveAccountAmountRoundingScale,
  getActiveAccountTimezone,
} from "@/lib/settings/account";
import { createClient, getCachedPermissionChecker } from "@/lib/supabase/server";

import { RecurringPage } from "./_components/recurring-page";

export const metadata: Metadata = { title: "Повторяющиеся платежи" };

/**
 * /finance/recurring — шаблоны повторяющихся платежей и их архив (`?archive=1`).
 *
 * Права:
 * - finance.view_transactions — вход на страницу и архив;
 * - finance.create_transaction — создание, правка, пауза, архив, возврат;
 * - finance.delete_transaction — удаление архивного шаблона навсегда;
 * - finance.manage_categories / manage_counterparties — создание прямо из панели;
 * - finance.view_all_venues — без него в панели выбирается только активное заведение.
 */
export default async function RecurringServerPage({
  searchParams,
}: {
  searchParams: Promise<{ archive?: string }>;
}) {
  const can = await getCachedPermissionChecker();
  if (!can("finance.view_transactions")) redirect("/dashboard");

  const permissions = {
    create: !!can("finance.create_transaction"),
    delete: !!can("finance.delete_transaction"),
    manageCategories: !!can("finance.manage_categories"),
    manageCounterparties: !!can("finance.manage_counterparties"),
    viewAllVenues: !!can("finance.view_all_venues"),
  };

  const [
    live,
    archived,
    { rows: bankAccounts },
    { rows: categories },
    { rows: counterparties },
    { rows: venues },
    activeVenueId,
    amountRoundingScale,
    timeZone,
    params,
  ] = await Promise.all([
    listRecurringTemplates({ archived: false }),
    listRecurringTemplates({ archived: true }),
    // Архивные — для подписей уже выбранного; в выборе только действующие.
    listBankAccounts({ include_deleted: true }),
    listFinanceCategories({ include_archived: true }),
    listCounterparties({ include_deleted: true }),
    listAccountVenues({ liveOnly: true }),
    getActiveVenueId(),
    getActiveAccountAmountRoundingScale(),
    getActiveAccountTimezone(),
    searchParams,
  ]);

  return (
    <RecurringPage
      templates={[...live.items, ...archived.items]}
      loadError={live.error ?? archived.error}
      bankAccounts={bankAccounts}
      categories={categories}
      counterparties={counterparties}
      venues={venues}
      formVenues={
        permissions.viewAllVenues ? venues : venues.filter((v) => v.id === activeVenueId)
      }
      permissions={permissions}
      amountRoundingScale={amountRoundingScale}
      dadataEnabled={isDadataConfigured()}
      timeZone={timeZone}
      initialArchive={params.archive === "1"}
    />
  );
}

/** Активное заведение: без view_all_venues шаблон можно привязать только к нему. */
async function getActiveVenueId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_active_venue_id");
  return (data as string | null) ?? null;
}
