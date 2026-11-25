import "server-only";

import { getActiveAccountTimezone } from "@/lib/settings/account";

/**
 * Сегодня (`ГГГГ-ММ-ДД`) в поясе активного аккаунта — как «сегодня» у
 * напоминаний в базе (`private.finance_account_today`).
 */
export async function todayIso(): Promise<string> {
  const timeZone = await getActiveAccountTimezone();
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());
  }
}
