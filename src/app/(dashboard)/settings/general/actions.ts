"use server";

import { revalidatePath } from "next/cache";

import { normalizeAmountRoundingScale } from "@/lib/format/amount";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { createClient } from "@/lib/supabase/server";

export async function updateGeneralSettings(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Не авторизован");

  const [{ data: accountId }, { data: allowed }] = await Promise.all([
    supabase.rpc("get_active_account_id"),
    supabase.rpc("has_permission", { permission_code: "settings.manage_integrations" }),
  ]);
  if (!accountId) throw new Error("Не удалось определить активный аккаунт");
  if (!allowed) throw new Error("Недостаточно прав");

  const amountRoundingScale = normalizeAmountRoundingScale(formData.get("amountRoundingScale"));
  const inventoryAiSuggestionsEnabled = formData.get("inventoryAiSuggestionsEnabled") === "1";
  const admin = asLooseDb(createAdminClient());
  const { error } = await admin
    .from("accounts")
    .update({
      amount_rounding_scale: amountRoundingScale,
      inventory_ai_suggestions_enabled: inventoryAiSuggestionsEnabled,
    })
    .eq("id", accountId);

  if (error) throw new Error(error.message);
  revalidatePath("/settings/general");
  revalidatePath("/finance");
  revalidatePath("/finance/transactions");
  revalidatePath("/finance/accounts");
  revalidatePath("/catalog/ingredients");
  revalidatePath("/documents/inventory");
  revalidatePath("/documents/inventory/[id]/results", "page");
}
