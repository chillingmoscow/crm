/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { EditDrawer } from "@/components/ui/edit-drawer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
    <EditDrawer
      open={ingredientId !== null}
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={data?.groupName ?? "Ингредиент"}
      footer={
        !loading && !error && data ? (
          <Button asChild variant="outline">
            <Link href={`/catalog/ingredients/${data.id}`}>
              <ExternalLink className="h-4 w-4" />
              Открыть карточку
            </Link>
          </Button>
        ) : undefined
      }
    >
      {loading ? (
        // Скелетон по форме обзора: фото и сетка полей 2×3.
        <div role="status" aria-label="Загружаем ингредиент" className="space-y-4">
          <Skeleton className="h-40 w-full rounded-lg" />
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="py-10 text-sm text-destructive">{error}</div>
      ) : !data ? (
        <div className="py-10 text-sm text-muted-foreground">
          Ингредиент не найден в каталоге
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex h-40 w-full items-center justify-center overflow-hidden rounded-lg border bg-muted">
            {data.imageUrl ? (
              <img src={data.imageUrl} alt={data.name} className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs text-muted-foreground">Нет фото</span>
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
        </div>
      )}
    </EditDrawer>
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
