import { redirect } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";

import { AMOUNT_ROUNDING_OPTIONS, normalizeAmountRoundingScale } from "@/lib/format/amount";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { updateGeneralSettings } from "./actions";

type AccountSettingsRow = {
  amount_rounding_scale: number | null;
  inventory_ai_suggestions_enabled: boolean | null;
};

export default async function GeneralSettingsPage() {
  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    { data: accountId },
    { data: allowed },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("get_active_account_id"),
    supabase.rpc("has_permission", { permission_code: "settings.manage_integrations" }),
  ]);

  if (!user) redirect("/login");
  if (!accountId || !allowed) redirect("/dashboard");

  const admin = createAdminClient();
  const { data: account } = await admin
    .from("accounts")
    .select("amount_rounding_scale, inventory_ai_suggestions_enabled")
    .eq("id", accountId)
    .maybeSingle<AccountSettingsRow>();

  const amountRoundingScale = normalizeAmountRoundingScale(account?.amount_rounding_scale);
  const inventoryAiSuggestionsEnabled = Boolean(account?.inventory_ai_suggestions_enabled);

  return (
    <div className="w-full px-4 py-4 md:px-8 md:py-6">
      <div className="mb-6">
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
          <SlidersHorizontal className="h-5 w-5" />
        </div>
        <h1 className="text-2xl font-semibold">Общие настройки</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Базовые параметры отображения для финансов и инвентаризации.
        </p>
      </div>

      <form action={updateGeneralSettings} className="max-w-xl rounded-lg border bg-background p-5">
        <div>
          <label className="text-sm font-medium" htmlFor="amountRoundingScale">
            Округление сумм
          </label>
          <p className="mt-1 text-sm text-muted-foreground">
            Применяется к финансовым суммам, себестоимости и итогам инвентаризации.
          </p>
          <select
            id="amountRoundingScale"
            name="amountRoundingScale"
            defaultValue={String(amountRoundingScale)}
            className="mt-3 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {AMOUNT_ROUNDING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} · {option.description}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-5 rounded-md border bg-muted/30 p-4">
          <label className="flex items-start gap-3 text-sm font-medium" htmlFor="inventoryAiSuggestionsEnabled">
            <input
              id="inventoryAiSuggestionsEnabled"
              name="inventoryAiSuggestionsEnabled"
              type="checkbox"
              value="1"
              defaultChecked={inventoryAiSuggestionsEnabled}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>
              AI-подсказки пересорта
              <span className="mt-1 block text-sm font-normal text-muted-foreground">
                Если включено и настроен AI API key, система сможет предлагать варианты пересорта.
                Подсказки не применяются автоматически.
              </span>
            </span>
          </label>
        </div>

        <div className="mt-5 flex justify-end">
          <Button type="submit">Сохранить</Button>
        </div>
      </form>
    </div>
  );
}
