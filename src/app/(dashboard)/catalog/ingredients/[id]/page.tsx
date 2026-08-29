import { redirect } from "next/navigation";

import { getCachedActiveAccountId, getCachedPermissionChecker } from "@/lib/supabase/server";
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
  const [can, accountId, amountRoundingScale] = await Promise.all([
    getCachedPermissionChecker(),
    getCachedActiveAccountId(),
    getActiveAccountAmountRoundingScale(),
  ]);
  const canView = can("inventory.view_products");
  const canManage = can("inventory.manage_products");
  if (!canView) redirect("/dashboard");
  if (!accountId) redirect("/dashboard");

  const ingredient = await getIngredientDetail(accountId as string, id);
  if (!ingredient) redirect("/catalog/ingredients");

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
      canManage={canManage}
      amountRoundingScale={amountRoundingScale}
    />
  );
}
