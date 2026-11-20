import type { Metadata } from "next";

import { CATALOG_KINDS } from "../_lib/kinds";
import { NomenclatureCatalog } from "../_components/nomenclature-catalog";

export const metadata: Metadata = { title: "Полуфабрикаты" };

export default async function SemiProductsCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const { scope } = await searchParams;
  return <NomenclatureCatalog config={CATALOG_KINDS.semi_finished} scope={scope} />;
}
