import { redirect } from "next/navigation";

import { catalogPath, type CatalogKindConfig } from "../_lib/kinds";

import { getCachedActiveAccountId, getCachedPermissionChecker } from "@/lib/supabase/server";
import { getActiveAccountAmountRoundingScale } from "@/lib/settings/account";
import {
  getIngredientDetail,
  listAccountCounterparties,
  listIngredientJournal,
  listIngredientSuppliers,
  listIngredientUsage,
} from "@/lib/inventory/ingredients";
import { IngredientDetail } from "../ingredients/[id]/_components/ingredient-detail";

/**
 * Карточка позиции каталога. Один компонент на все три раздела — различаются
 * они только видом номенклатуры и тем, куда возвращать при промахе по id.
 */
export async function NomenclatureDetail({
  config,
  id,
}: {
  config: CatalogKindConfig;
  id: string;
}) {
  const [can, accountId, amountRoundingScale] = await Promise.all([
    getCachedPermissionChecker(),
    getCachedActiveAccountId(),
    getActiveAccountAmountRoundingScale(),
  ]);
  const canView = can("inventory.view_products");
  const canManage = can("inventory.manage_products");
  if (!canView) redirect("/dashboard");
  if (!accountId) redirect("/dashboard");

  const ingredient = await getIngredientDetail(accountId as string, id, config.kind);
  if (!ingredient) redirect(catalogPath(config));

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
