/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2 } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { formatMoney, type AmountRoundingScale } from "@/lib/format/amount";
import { getInventoryIngredientOverview } from "@/app/(dashboard)/inventory/_actions/catalog";
import type { IngredientDetail } from "@/lib/inventory/ingredients";

/**
 * Боковая панель с «Обзором» ингредиента. Открывается кликом по названию
 * позиции в таблице «Итоги» (см. results-table.tsx). Данные подгружаются
 * лениво через getInventoryIngredientOverview (переиспользует
 * getIngredientDetail). Полную карточку открывает ссылка внизу.
 */
export function IngredientOverviewSheet({
  ingredientId,
  fallbackName,
  amountRoundingScale,
  onClose,
}: {
  ingredientId: string | null;
  fallbackName: string;
  amountRoundingScale: AmountRoundingScale;
  onClose: () => void;
}) {
  const [data, setData] = useState<IngredientDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ingredientId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setData(null);
    void getInventoryIngredientOverview({ ingredientId }).then((res) => {
      if (!alive) return;
      if (res.error) setError(res.error);
      else setData(res.data);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [ingredientId]);

  const title = data?.name ?? fallbackName;

  return (
    <Sheet open={ingredientId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="truncate">{title}</SheetTitle>
          <SheetDescription>
            {data?.groupName ?? "Ингредиент"}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка…
          </div>
        ) : error ? (
          <div className="py-10 text-sm text-destructive">{error}</div>
        ) : !data ? (
          <div className="py-10 text-sm text-muted-foreground">
            Ингредиент не найден в каталоге.
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="flex h-40 w-full items-center justify-center overflow-hidden rounded-lg border bg-muted">
              {data.imageUrl ? (
                <img src={data.imageUrl} alt={data.name} className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-muted-foreground">нет фото</span>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Field label="Группа" value={data.groupName} />
              <Field label="Ед. изм." value={data.measureUnitName} />
              <Field label="Артикул" value={data.article} />
              <Field label="Штрих-код" value={data.barcode} />
              <Field
                label="Себестоимость"
                value={
                  data.currentPrimeCost != null
                    ? formatMoney(data.currentPrimeCost, "RUB", amountRoundingScale)
                    : null
                }
              />
              <Field
                label="Остаток"
                value={data.storeQuantityKg != null ? String(data.storeQuantityKg) : null}
              />
            </dl>

            {data.localDescription ? (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Описание</div>
                <p className="whitespace-pre-wrap text-sm">{data.localDescription}</p>
              </div>
            ) : null}

            <Button asChild variant="outline" className="w-full">
              <Link href={`/catalog/ingredients/${data.id}`}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Открыть карточку
              </Link>
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate">{value ?? "—"}</dd>
    </div>
  );
}
