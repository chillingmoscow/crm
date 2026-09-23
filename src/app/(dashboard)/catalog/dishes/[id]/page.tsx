import { CATALOG_KINDS } from "../../_lib/kinds";
import { NomenclatureDetail } from "../../_components/nomenclature-detail";

export default async function DishDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <NomenclatureDetail config={CATALOG_KINDS.dish} id={id} />;
}
