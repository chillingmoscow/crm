import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getActiveAccountAmountRoundingScale } from "@/lib/settings/account";
import {
  getIngredientDetail,
  listAccountCounterparties,
  listIngredientJournal,
  listIngredientSuppliers,
  listIngredientUsage,
} from "@/lib/inventory/ingredients";
import { IngredientDetail } from "./_components/ingredient-detail";

export default async function IngredientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: canView }, { data: canManage }, { data: accountId }, amountRoundingScale] =
    await Promise.all([
      supabase.rpc("has_permission", { permission_code: "inventory.view_products" }),
      supabase.rpc("has_permission", { permission_code: "inventory.manage_products" }),
      supabase.rpc("get_active_account_id"),
      getActiveAccountAmountRoundingScale(),
    ]);
  if (!canView) redirect("/dashboard");
  if (!accountId) redirect("/dashboard");

  const ingredient = await getIngredientDetail(accountId as string, id);
  if (!ingredient) redirect("/inventory/products");

  const [suppliers, usage, journal, counterparties] = await Promise.all([
    listIngredientSuppliers(accountId as string, id),
    listIngredientUsage(accountId as string, id),
    listIngredientJournal(accountId as string, id),
    canManage ? listAccountCounterparties(accountId as string) : Promise.resolve([]),
  ]);

  return (
    <IngredientDetail
      ingredient={ingredient}
      suppliers={suppliers}
      usage={usage}
      journal={journal}
      counterparties={counterparties}
      canManage={Boolean(canManage)}
      amountRoundingScale={amountRoundingScale}
    />
  );
}
