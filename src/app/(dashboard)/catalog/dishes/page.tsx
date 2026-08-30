import { CATALOG_KINDS } from "../_lib/kinds";
import { NomenclatureCatalog } from "../_components/nomenclature-catalog";

export default async function DishesCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const { scope } = await searchParams;
  return <NomenclatureCatalog config={CATALOG_KINDS.dish} scope={scope} />;
}
