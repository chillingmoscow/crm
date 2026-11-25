"use server";

import { revalidatePath } from "next/cache";

import { actionResult } from "@/lib/actions/result";
import { normalizeAmountRoundingScale } from "@/lib/format/amount";
import { TIMEZONES } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";

async function updateGeneralSettingsImpl(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Не авторизован");

  const [accountId, can] = await Promise.all([
    getCachedActiveAccountId(),
    getCachedPermissionChecker(),
  ]);
  const allowed = can("settings.manage_integrations");
  if (!accountId) throw new Error("Не удалось определить активный аккаунт");
  if (!allowed) throw new Error("Недостаточно прав");

  const amountRoundingScale = normalizeAmountRoundingScale(formData.get("amountRoundingScale"));
  const inventoryAiSuggestionsEnabled = formData.get("inventoryAiSuggestionsEnabled") === "1";
  // Пояс — только из списка интерфейса: все они от UTC+0 до UTC+12, и ручные
  // операции (полночь UTC) остаются в своём дне.
  const timezoneValue = String(formData.get("timezone") ?? "");
  const timezone = TIMEZONES.some((t) => t.value === timezoneValue) ? timezoneValue : null;
  const admin = asLooseDb(createAdminClient());
  const { error } = await admin
    .from("accounts")
    .update({
      amount_rounding_scale: amountRoundingScale,
      inventory_ai_suggestions_enabled: inventoryAiSuggestionsEnabled,
      ...(timezone ? { timezone } : {}),
    })
    .eq("id", accountId);

  if (error) throw error;
  revalidatePath("/settings/general");
  revalidatePath("/finance");
  revalidatePath("/finance/transactions");
  revalidatePath("/finance/categories");
  revalidatePath("/finance/counterparties");
  revalidatePath("/finance/accounts");
  revalidatePath("/catalog/ingredients");
  revalidatePath("/documents/inventory");
  revalidatePath("/documents/inventory/[id]/results", "page");
}

// Действие возвращает ошибку текстом, а не исключением: в рабочей сборке Next.js
// заменяет текст брошенного исключения английской заглушкой (см. lib/actions/result).
export async function updateGeneralSettings(formData: FormData) {
  return actionResult(() => updateGeneralSettingsImpl(formData), "Не удалось сохранить настройки");
}
