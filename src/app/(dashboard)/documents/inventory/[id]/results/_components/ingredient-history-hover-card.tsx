"use client";

import { useRef, useState } from "react";
import { History, Loader2, Repeat2, XCircle } from "lucide-react";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import {
  formatQuantityAmount,
  formatSignedMoney,
  signedAmountClass,
  type AmountRoundingScale,
} from "@/lib/format/amount";
import { pluralRu } from "@/lib/format/plural";
import { summarizeIngredientHistory } from "@/lib/inventory/ingredient-history-shared";
import type { IngredientHistoryEntry } from "@/lib/inventory/ingredients";
import { getInventoryIngredientHistory } from "@/app/(dashboard)/inventory/_actions/catalog";

/**
 * Что было с этой позицией в прошлых актах — карточкой по наведению на название
 * в итогах.
 *
 * Грузится лениво и только один раз на позицию: в акте бывают сотни строк, и
 * тянуть историю по всем заранее значило бы платить за то, чего никто не
 * откроет. Кэш живёт в родителе (таблице), поэтому переезд курсора туда-обратно
 * запросов не плодит.
 *
 * Текущий акт из списка исключён — пользователь и так стоит в его итогах.
 */
export function IngredientHistoryHoverCard({
  ingredientId,
  documentId,
  amountRoundingScale,
  cache,
  children,
}: {
  ingredientId: string;
  documentId: string;
  amountRoundingScale: AmountRoundingScale;
  /** Общий на таблицу кэш «позиция → её прошлые акты». */
  cache: Map<string, IngredientHistoryEntry[]>;
  children: React.ReactNode;
}) {
  const [entries, setEntries] = useState<IngredientHistoryEntry[] | null>(
    () => cache.get(ingredientId) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const requested = useRef(false);

  const load = () => {
    if (requested.current) return;
    const cached = cache.get(ingredientId);
    if (cached) {
      setEntries(cached);
      return;
    }
    requested.current = true;
    void getInventoryIngredientHistory({
      ingredientId,
      excludeDocumentId: documentId,
    }).then((res) => {
      if (res.error) {
        // Разрешаем повтор: отказ мог быть сетевым, а не по правам.
        requested.current = false;
        setError(res.error);
        return;
      }
      cache.set(ingredientId, res.data);
      setEntries(res.data);
    });
  };

  return (
    <HoverCard openDelay={350} closeDelay={120} onOpenChange={(open) => open && load()}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="w-96">
        <HistoryBody
          entries={entries}
          error={error}
          amountRoundingScale={amountRoundingScale}
        />
      </HoverCardContent>
    </HoverCard>
  );
}

function HistoryBody({
  entries,
  error,
  amountRoundingScale,
}: {
  entries: IngredientHistoryEntry[] | null;
  error: string | null;
  amountRoundingScale: AmountRoundingScale;
}) {
  if (error) {
    return <div className="py-2 text-sm text-destructive">{error}</div>;
  }

  if (!entries) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Загрузка истории…
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-start gap-2 py-1 text-sm text-muted-foreground">
        <History className="mt-0.5 h-4 w-4 shrink-0" />
        Позиция впервые встречается в этом акте — сравнивать не с чем.
      </div>
    );
  }

  const summary = summarizeIngredientHistory(entries);
  const breakdown = [
    summary.surplusActs > 0 ? `${summary.surplusActs} в плюс` : null,
    summary.shortfallActs > 0 ? `${summary.shortfallActs} в минус` : null,
    summary.evenActs > 0 ? `${summary.evenActs} ровно` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium">
        <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        Прошлые акты
      </div>

      {summary.countedActs > 0 ? (
        <p className="text-xs text-muted-foreground">
          {summary.countedActs} {pluralRu(summary.countedActs, "акт", "акта", "актов")}
          {breakdown.length > 0 ? `: ${breakdown.join(", ")}` : ""} · итого{" "}
          <span className={cn("font-medium tabular-nums", signedAmountClass(summary.netSum))}>
            {formatSignedMoney(summary.netSum, "RUB", amountRoundingScale)}
          </span>
        </p>
      ) : null}

      <ul className="space-y-1">
        {entries.map((entry) => (
          <li key={entry.documentId} className="flex items-baseline gap-2 text-xs">
            <span className="w-16 shrink-0 tabular-nums text-muted-foreground">
              {entry.invoiceDate
                ? new Date(entry.invoiceDate).toLocaleDateString("ru-RU")
                : "—"}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {entry.documentNumber}
            </span>
            <span
              className={cn(
                "shrink-0 tabular-nums",
                entry.counted ? signedAmountClass(entry.differenceAmount) : "text-muted-foreground",
              )}
            >
              {formatDifference(entry, amountRoundingScale)}
            </span>
            <span className="w-4 shrink-0">
              {entry.excluded ? (
                <XCircle
                  className="h-3.5 w-3.5 text-red-700 dark:text-red-400"
                  aria-label="Строка не учитывалась в итогах"
                />
              ) : entry.resort ? (
                <Repeat2
                  className="h-3.5 w-3.5 text-blue-700 dark:text-blue-300"
                  aria-label="Закрыто пересортом"
                />
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-[11px] leading-snug text-muted-foreground">
        Разница фактическая. Значки: <XCircle className="inline h-3 w-3" /> — строка не
        учитывалась в итогах, <Repeat2 className="inline h-3 w-3" /> — закрыта пересортом.
      </p>
    </div>
  );
}

function formatDifference(
  entry: IngredientHistoryEntry,
  scale: AmountRoundingScale,
): string {
  if (!entry.counted || entry.differenceAmount == null) return "—";
  const sign = entry.differenceAmount > 0 ? "+" : entry.differenceAmount < 0 ? "−" : "";
  const unit = entry.measureUnitName ?? "ед.";
  return `${sign}${formatQuantityAmount(Math.abs(entry.differenceAmount), scale)} ${unit}`;
}
