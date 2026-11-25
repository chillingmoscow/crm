import Link from "next/link";
import { Star } from "lucide-react";

import { Money } from "@/components/shared/money";
import { ProfileSection } from "@/components/shared/profile-section";
import { CATALOG_KINDS, type CatalogKind } from "@/app/(dashboard)/catalog/_lib/kinds";

export type CounterpartyPurchase = {
  id: string;
  ingredientId: string;
  name: string;
  kind: string;
  archived: boolean;
  article: string | null;
  price: number | null;
  isPreferred: boolean;
};

const isCatalogKind = (kind: string): kind is CatalogKind => kind in CATALOG_KINDS;

/**
 * Вкладка «Закупаем»: позиции номенклатуры, к которым контрагент привязан
 * поставщиком. Только просмотр — поставщика добавляют в карточке позиции.
 */
export function CounterpartyPurchases({ purchases }: { purchases: CounterpartyPurchase[] }) {
  return (
    <ProfileSection
      title="Закупаем"
      description="Позиции номенклатуры, которые берём у этого контрагента"
    >
      {purchases.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Позиции номенклатуры к этому поставщику не привязаны. Поставщика добавляют в карточке позиции, вкладка
          «Поставщики»
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {purchases.map((item) => {
            const config = isCatalogKind(item.kind) ? CATALOG_KINDS[item.kind] : null;
            const meta = [
              config?.itemNoun ?? (item.kind === "modifier" ? "Модификатор" : "Товар"),
              item.article ? `арт. ${item.article}` : null,
              item.archived ? "в архиве" : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {config ? (
                      <Link
                        href={`/catalog/${config.slug}/${item.ingredientId}`}
                        className="truncate text-sm font-medium hover:underline"
                        data-tip={item.name}
                      >
                        {item.name}
                      </Link>
                    ) : (
                      <span className="truncate text-sm font-medium" data-tip={item.name}>
                        {item.name}
                      </span>
                    )}
                    {item.isPreferred ? (
                      <Star
                        className="size-3.5 shrink-0 fill-amber-400 text-amber-500"
                        aria-label="Основной поставщик"
                        data-tip="Основной поставщик"
                      />
                    ) : null}
                  </div>
                  <span className="block truncate text-xs text-muted-foreground">{meta}</span>
                </div>
                {item.price != null ? (
                  <span className="shrink-0 text-sm tabular-nums">
                    <Money value={item.price} fraction="auto" />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </ProfileSection>
  );
}
