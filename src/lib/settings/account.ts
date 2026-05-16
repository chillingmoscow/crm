import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_AMOUNT_ROUNDING_SCALE,
  normalizeAmountRoundingScale,
  type AmountRoundingScale,
} from "@/lib/format/amount";

type AccountSettingsRow = {
  amount_rounding_scale: number | null;
};

export async function getActiveAccountAmountRoundingScale(): Promise<AmountRoundingScale> {
  const supabase = await createClient();
  const { data: accountId } = await supabase.rpc("get_active_account_id");
  if (!accountId) return DEFAULT_AMOUNT_ROUNDING_SCALE;

  const admin = createAdminClient();
  const { data } = await admin
    .from("accounts")
    .select("amount_rounding_scale")
    .eq("id", accountId)
    .maybeSingle<AccountSettingsRow>();

  return normalizeAmountRoundingScale(data?.amount_rounding_scale);
}
