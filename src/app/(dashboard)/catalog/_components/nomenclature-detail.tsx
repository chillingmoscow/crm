import { redirect } from "next/navigation";

import { catalogPath, type CatalogKindConfig } from "../_lib/kinds";

import { getCachedActiveAccountId, getCachedPermissionChecker } from "@/lib/supabase/server";
import {
  getIngredientDetail,
  listAccountCounterparties,
  listIngredientHistory,
  listIngredientJournal,
  listIngredientSuppliers,
} from "@/lib/inventory/ingredients";
import { NomenclatureCard } from "./nomenclature-card";

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
  const [can, accountId] = await Promise.all([
    getCachedPermissionChecker(),
    getCachedActiveAccountId(),
  ]);
  const canView = can("inventory.view_products");
  const canManage = can("inventory.manage_products");
  // Итоги в истории закрыты своим правом — тем же, по которому пускает страница
  // итогов акта. Без него вкладка показывает только «где встречается».
  const canViewResults = can("inventory.view_results");
  if (!canView) redirect("/dashboard");
  if (!accountId) redirect("/dashboard");

  const ingredient = await getIngredientDetail(accountId as string, id, config.kind);
  if (!ingredient) redirect(catalogPath(config));

  const [suppliers, history, journal, counterparties] = await Promise.all([
    listIngredientSuppliers(accountId as string, id),
    listIngredientHistory(accountId as string, id, canViewResults),
    listIngredientJournal(accountId as string, id),
    canManage ? listAccountCounterparties(accountId as string) : Promise.resolve([]),
  ]);

  return (
    <NomenclatureCard
      config={config}
      item={ingredient}
      suppliers={suppliers}
      history={history}
      journal={journal}
      counterparties={counterparties}
      canManage={canManage}
      canViewResults={canViewResults}
    />
  );
}
