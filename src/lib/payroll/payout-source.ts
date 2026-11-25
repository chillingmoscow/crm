import "server-only";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { LooseDb } from "@/lib/supabase/loose";
import { businessDate } from "@/lib/sales/time";
import { normalizeOfficialExpected, type OfficialExpectedRow } from "./official-expected";
import type { PayoutSourceData } from "./payout-engine";
import type { PayrollData } from "./types";

/**
 * Данные ведомости заведения для автовыдачи — серверным клиентом, без
 * пользователя: те же таблицы, что читает «Зарплата» для плана выплат.
 */
export async function loadVenuePayoutData(admin: LooseDb, accountId: string, venueId: string): Promise<PayoutSourceData> {
  const table = <T>(name: string) =>
    fetchAllRows<T>(() => admin.from<T[]>(name).select("*").eq("account_id", accountId).eq("venue_id", venueId));
  const [employees, accruals, adjustments, payments, allocations, transfers, settings, venue, hours, banks] = await Promise.all([
    table<PayrollData["employees"][number]>("payroll_employees"),
    table<PayrollData["accruals"][number]>("payroll_accruals"),
    table<PayrollData["adjustments"][number]>("payroll_adjustments"),
    table<PayrollData["payments"][number]>("payroll_payments"),
    table<PayrollData["allocations"][number]>("payroll_allocations"),
    table<PayrollData["transfers"][number]>("payroll_transfers"),
    admin.from<PayrollData["settings"]>("payroll_settings").select("*").eq("account_id", accountId).eq("venue_id", venueId).maybeSingle(),
    admin.from<{ timezone: string }>("venues").select("timezone").eq("id", venueId).single(),
    admin.from<{ day_start_hour: number }>("sales_settings").select("day_start_hour").eq("account_id", accountId).eq("venue_id", venueId).maybeSingle(),
    admin
      .from<PayrollData["banks"]>("bank_accounts")
      .select("id,name,legal_entity_id,type")
      .eq("account_id", accountId)
      .eq("is_active", true)
      .eq("currency", "RUB")
      .or(`venue_id.is.null,venue_id.eq.${venueId}`),
  ]);
  for (const r of [settings, venue, hours, banks]) if (r.error) throw new Error(r.error.message);
  const timezone = venue.data?.timezone ?? "Europe/Moscow";
  const dayStartHour = hours.data?.day_start_hour ?? 9;
  const today = businessDate(new Date(), timezone, dayStartHour);
  const expected = await admin.rpc("payroll_official_expected_for", {
    p_account: accountId,
    p_venue: venueId,
    p_from: "2000-01-01",
    p_to: `${today.slice(0, 7)}-01`,
  });
  if (expected.error) throw new Error(expected.error.message);
  return {
    employees,
    accruals,
    adjustments,
    payments,
    allocations,
    transfers,
    settings: settings.data,
    officialExpected: normalizeOfficialExpected(expected.data as OfficialExpectedRow[] | null),
    timezone,
    dayStartHour,
    banks: banks.data ?? [],
  };
}
