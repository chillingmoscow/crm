import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { cache } from "react";

import { getCachedActiveAccountId } from "@/lib/supabase/server";
import {
  DEFAULT_AMOUNT_ROUNDING_SCALE,
  normalizeAmountRoundingScale,
  type AmountRoundingScale,
} from "@/lib/format/amount";

type AccountSettingsRow = {
  amount_rounding_scale: number | null;
};

/**
 * Настройка округления сумм активного аккаунта.
 *
 * Обёрнута в `React.cache`: хелпер зовут девять страниц (финансы, каталог,
 * инвентаризация), и на некоторых он раньше отрабатывал дважды за рендер.
 * Внутри — тоже кэшированный `getCachedActiveAccountId`, а не сырой RPC:
 * активный аккаунт к этому моменту уже прочитал layout, и второй сетевой
 * вызов был лишним. На self-hosted один round-trip стоит десятки миллисекунд,
 * а страницы выстраивают их в последовательные волны.
 */
export const getActiveAccountAmountRoundingScale = cache(async (): Promise<AmountRoundingScale> => {
  const accountId = await getCachedActiveAccountId();
  if (!accountId) return DEFAULT_AMOUNT_ROUNDING_SCALE;

  const admin = createAdminClient();
  const { data } = await admin
    .from("accounts")
    .select("amount_rounding_scale")
    .eq("id", accountId)
    .maybeSingle<AccountSettingsRow>();

  return normalizeAmountRoundingScale(data?.amount_rounding_scale);
});
