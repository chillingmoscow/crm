import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { listBankAccounts } from "@/lib/finance/bank-accounts";
import { listFinanceCategories } from "@/lib/finance/categories";
import { listCounterparties } from "@/lib/finance/counterparties";
import { listInbox } from "@/lib/finance/recurring";
import { calendarDateInZone } from "@/lib/format/zoned-day";
import { listAccountVenues } from "@/lib/org/legal-entities";
import {
  getActiveAccountAmountRoundingScale,
  getActiveAccountTimezone,
} from "@/lib/settings/account";
import { createClient, getCachedPermissionChecker } from "@/lib/supabase/server";

import { InboxPage } from "./_components/inbox-page";

export const metadata: Metadata = { title: "На разбор" };

/**
 * /finance/inbox — очередь ожидаемых платежей, наступивших по расписанию
 * повторяющихся шаблонов. Разбор по одной карточке: провести, пропустить,
 * перенести. Открытие очереди само порождает недостающие сроки аккаунта
 * (`listInbox`), так что молчащий cron не оставит её пустой.
 *
 * Права:
 * - finance.view_transactions — вход и просмотр карточек;
 * - finance.create_transaction — разбор (без него карточки только для чтения);
 * - finance.view_all_venues — без него заведение выбирается только активное.
 */
export default async function InboxServerPage() {
  const can = await getCachedPermissionChecker();
  if (!can("finance.view_transactions")) redirect("/dashboard");

  const canResolve = !!can("finance.create_transaction");
  const viewAllVenues = !!can("finance.view_all_venues");

  const [
    inbox,
    { rows: bankAccounts },
    { rows: categories },
    { rows: counterparties },
    { rows: venues },
    activeVenueId,
    amountRoundingScale,
    timeZone,
  ] = await Promise.all([
    listInbox(),
    // С архивными: снимок платежа мог сослаться на то, что уже в архиве.
    listBankAccounts({ include_deleted: true }),
    listFinanceCategories({ include_archived: true }),
    listCounterparties({ include_deleted: true }),
    listAccountVenues({ liveOnly: true }),
    getActiveVenueId(),
    getActiveAccountAmountRoundingScale(),
    getActiveAccountTimezone(),
  ]);

  return (
    <InboxPage
      items={inbox.items}
      loadError={inbox.error}
      bankAccounts={bankAccounts}
      categories={categories}
      counterparties={counterparties}
      venues={venues}
      formVenues={viewAllVenues ? venues : venues.filter((v) => v.id === activeVenueId)}
      canResolve={canResolve}
      amountRoundingScale={amountRoundingScale}
      today={calendarDateInZone(new Date().toISOString(), timeZone)}
    />
  );
}

/** Активное заведение: без view_all_venues операция привязывается только к нему. */
async function getActiveVenueId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_active_venue_id");
  return (data as string | null) ?? null;
}
