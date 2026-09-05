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
  formatSignedInventoryQuantity,
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
 * В списке только то, что было ДО открытого акта: сам он и всё, что прошло
 * после него, отброшены — иначе в «прошлых актах» у старого документа оказались
 * бы более поздние.
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
      setError(null);
      return;
    }
    requested.current = true;
    // Ошибку снимаем на входе: иначе удачный повтор дорисовал бы список, но
    // экран так и остался бы на прежнем сообщении об ошибке.
    setError(null);
    // Отказ промиса (сеть отвалилась) тоже обязан отпускать requested — иначе
    // повтор невозможен и карточка навсегда залипает на спиннере.
    void getInventoryIngredientHistory({
      ingredientId,
      currentDocumentId: documentId,
    })
      .then((res) => {
        if (res.error) {
          requested.current = false;
          setError(res.error);
          return;
        }
        cache.set(ingredientId, res.data);
        setEntries(res.data);
      })
      .catch(() => {
        requested.current = false;
        setError("Не удалось загрузить историю");
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
  const hasExcluded = entries.some((entry) => entry.excluded);
  const hasResort = entries.some((entry) => entry.resort);
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
              {formatDifference(entry)}
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

      {/* Легенда по строкам, а не сплошным абзацем: значок и его расшифровка
          должны читаться парой. Показываем только те значки, что реально есть в
          списке — объяснять отсутствующий смысла нет. */}
      <div className="space-y-1 border-t pt-2 text-[11px] leading-snug text-muted-foreground">
        <p>Разница фактическая.</p>
        {hasExcluded ? (
          <p className="flex items-start gap-1.5">
            <XCircle className="mt-px h-3 w-3 shrink-0 text-red-700 dark:text-red-400" />
            строка не учитывалась в итогах
          </p>
        ) : null}
        {hasResort ? (
          <p className="flex items-start gap-1.5">
            <Repeat2 className="mt-px h-3 w-3 shrink-0 text-blue-700 dark:text-blue-300" />
            закрыта пересортом
          </p>
        ) : null}
      </div>
    </div>
  );
}

function formatDifference(entry: IngredientHistoryEntry): string {
  if (!entry.counted || entry.differenceAmount == null) return "—";
  return formatSignedInventoryQuantity(entry.differenceAmount, entry.measureUnitName);
}
