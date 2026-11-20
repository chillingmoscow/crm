import type { Metadata } from "next";

import { CATALOG_KINDS } from "../../_lib/kinds";
import { NomenclatureDetail } from "../../_components/nomenclature-detail";

export const metadata: Metadata = { title: "Ингредиент" };

export default async function IngredientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <NomenclatureDetail config={CATALOG_KINDS.ingredient} id={id} />;
}
