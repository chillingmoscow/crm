import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { financeSource } from "@/lib/sales/finance-source";
import { normalizeCashControl } from "@/lib/sales/cash-control";
import { addDays } from "@/lib/sales/time";
import { registerCash, type RegisterCash } from "./payout-issue";

/**
 * Наличные в кассах сейчас — по кассовым отчётам Quick Resto за сегодня и вчера.
 * null — Quick Resto не ответил или ни по одной кассе нет суммы: выдавать нельзя.
 * Граница рабочего дня — из настроек продаж (её же сверяет financeSource).
 */
export async function readRegisterCash(
  accountId: string,
  venueId: string,
  today: string,
): Promise<RegisterCash[] | null> {
  try {
    const settings = await asLooseDb(createAdminClient())
      .from<{ timezone: string; day_start_hour: number }>("sales_settings")
      .select("timezone,day_start_hour")
      .eq("account_id", accountId)
      .eq("venue_id", venueId)
      .single();
    if (settings.error || !settings.data) return null;
    const request = { timezone: settings.data.timezone, dayStartHour: settings.data.day_start_hour };
    const read = async (date: string) => {
      const { source } = await financeSource({ account_id: accountId, venue_id: venueId, business_date: date, request });
      return normalizeCashControl(await source.cashControlList(), date, request.timezone, request.dayStartHour);
    };
    const [current, previous] = await Promise.all([read(today), read(addDays(today, -1))]);
    return registerCash(current, previous);
  } catch (error) {
    console.error("[payroll-payout] наличные касс не прочитаны", error);
    return null;
  }
}
