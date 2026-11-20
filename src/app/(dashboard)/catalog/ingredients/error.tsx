"use client";

import { CatalogError } from "../_components/catalog-error";

export default function CatalogRouteError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <CatalogError {...props} title="Не удалось открыть ингредиенты" />;
}
