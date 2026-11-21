import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { cache } from "react";

import { getCachedActiveAccountId } from "@/lib/supabase/server";
import {
  DEFAULT_AMOUNT_ROUNDING_SCALE,
  normalizeAmountRoundingScale,
  type AmountRoundingScale,
} from "@/lib/format/amount";

type AccountSettingsRow = {
  amount_rounding_scale: number | null;
  timezone: string | null;
};

/** Пояс, если в аккаунте его нет (как default колонки, миграция 370). */
export const DEFAULT_ACCOUNT_TIMEZONE = "Europe/Moscow";

/**
 * Настройки активного аккаунта одним запросом на рендер.
 *
 * Обёрнуто в `React.cache`: хелперы зовут девять страниц (финансы, каталог,
 * инвентаризация), и на некоторых они раньше отрабатывали дважды за рендер.
 * Внутри — тоже кэшированный `getCachedActiveAccountId`, а не сырой RPC:
 * активный аккаунт к этому моменту уже прочитал layout, и второй сетевой
 * вызов был лишним. На self-hosted один round-trip стоит десятки миллисекунд,
 * а страницы выстраивают их в последовательные волны.
 */
const getActiveAccountSettingsRow = cache(async (): Promise<AccountSettingsRow | null> => {
  const accountId = await getCachedActiveAccountId();
  if (!accountId) return null;

  const admin = createAdminClient();
  const { data } = await asLooseDb(admin)
    .from<AccountSettingsRow>("accounts")
    .select("amount_rounding_scale, timezone")
    .eq("id", accountId)
    .maybeSingle();
  return (data as AccountSettingsRow | null) ?? null;
});

/** Настройка округления сумм активного аккаунта. */
export const getActiveAccountAmountRoundingScale = cache(async (): Promise<AmountRoundingScale> => {
  const row = await getActiveAccountSettingsRow();
  return row ? normalizeAmountRoundingScale(row.amount_rounding_scale) : DEFAULT_AMOUNT_ROUNDING_SCALE;
});

/** Часовой пояс аккаунта — граница дня в периодах «Финансов». */
export const getActiveAccountTimezone = cache(async (): Promise<string> => {
  const row = await getActiveAccountSettingsRow();
  return row?.timezone?.trim() || DEFAULT_ACCOUNT_TIMEZONE;
});
