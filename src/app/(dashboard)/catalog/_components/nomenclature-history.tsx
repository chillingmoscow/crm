"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Repeat2, XCircle } from "lucide-react";

import { IconTooltip } from "@/components/ui/icon-tooltip";
import { InventoryStatusBadge } from "@/components/shared/inventory-status-badge";
import { LocalDateTime } from "@/components/shared/local-date-time";
import { Money, formatRub } from "@/components/shared/money";
import { ProfileSection } from "@/components/shared/profile-section";
import {
  formatInventoryQuantity,
  formatSignedInventoryQuantity,
  signedAmountClass,
} from "@/lib/format/amount";
import { countRu, pluralRu } from "@/lib/format/plural";
import { cn } from "@/lib/utils";
import {
  summarizeIngredientHistory,
  type IngredientHistoryEntry,
  type IngredientHistorySummary,
} from "@/lib/inventory/ingredient-history-shared";

const acts = (count: number) => countRu(count, "акт", "акта", "актов");

/**
 * Сколько раз позиция уходила в плюс, сколько в минус. Разбивка считается
 * только по сданным актам — у остальных разницы нет.
 */
function HistorySummaryLine({ summary }: { summary: IngredientHistorySummary }) {
  // «Ещё не сдан» и «сдан, но расчёта нет» — разные вещи, и вторую нельзя
  // называть первой: у сданного акта Quick Resto мог не вернуть построчные
  // расчёты, исполнитель тут ни при чём.
  const tail = [
    summary.pendingActs > 0
      ? `${acts(summary.pendingActs)} ещё ${pluralRu(summary.pendingActs, "не сдан", "не сданы", "не сданы")}`
      : null,
    summary.actsWithoutAmounts > 0 ? `по ${acts(summary.actsWithoutAmounts)} нет расчёта` : null,
  ].filter(Boolean);

  if (summary.countedActs === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Итогов пока нет{tail.length > 0 ? `: ${tail.join(", ")}` : ""}
      </p>
    );
  }

  const breakdown = [
    summary.surplusActs > 0 ? `${summary.surplusActs} в плюс` : null,
    summary.shortfallActs > 0 ? `${summary.shortfallActs} в минус` : null,
    summary.evenActs > 0 ? `${summary.evenActs} ровно` : null,
  ].filter(Boolean);

  return (
    <p className="text-sm text-muted-foreground">
      {acts(summary.countedActs)} с итогами
      {breakdown.length > 0 ? `: ${breakdown.join(", ")}` : ""} · итого{" "}
      <Money value={summary.netSum} signed className="font-medium" />
      {tail.length > 0 ? ` · ${tail.join(" · ")}` : ""}
    </p>
  );
}

/**
 * Разница по строке — либо число, либо прочерк с объяснением, почему его нет.
 * Причины две и путать их нельзя: акт ещё не сдан (разницы не существует) и акт
 * сдан, но Quick Resto не вернул построчный расчёт.
 */
function HistoryDifference({ item }: { item: IngredientHistoryEntry }) {
  if (!item.counted) {
    return (
      <IconTooltip
        label="Акт ещё не сдан"
        description="Пока исполнитель не сдал акт, разницы не существует: она появится вместе с итогами"
      >
        <span className="cursor-help">—</span>
      </IconTooltip>
    );
  }
  if (item.differenceAmount == null) {
    return (
      <IconTooltip
        label="Расчёта по строке нет"
        description="Акт сдан, но Quick Resto не вернул по этой позиции построчный расчёт. Обновите итоги акта, если расчёт нужен"
      >
        <span className="cursor-help">—</span>
      </IconTooltip>
    );
  }
  return <>{formatSignedInventoryQuantity(item.differenceAmount, item.measureUnitName)}</>;
}

/**
 * Почему фактическая разница строки могла не дойти до управленческого итога.
 * Слова и иконки — те же, что в итогах акта, чтобы одно и то же состояние не
 * называлось на двух экранах по-разному.
 */
function HistoryMarks({ item }: { item: IngredientHistoryEntry }) {
  if (item.excluded) {
    return (
      <IconTooltip
        label="Строка не учитывается в итогах"
        description={
          item.excludeReason
            ? `Причина: ${item.excludeReason}`
            : "Ревьюер исключил строку из управленческих итогов акта"
        }
      >
        <span className="inline-flex cursor-help items-center gap-1.5 text-xs text-destructive">
          <XCircle className="size-3.5 shrink-0" />
          Не учитывать
        </span>
      </IconTooltip>
    );
  }
  if (item.resort) {
    const remaining = item.resort.remainingDifferenceAmount;
    return (
      <IconTooltip
        label="Закрыто пересортом"
        description={`Зачтено ${formatInventoryQuantity(item.resort.offsetAmount, item.measureUnitName)}; после зачёта осталось ${formatSignedInventoryQuantity(remaining, item.measureUnitName)} (${formatRub(item.resort.remainingDifferenceSum, { signed: true })})`}
      >
        <span className="inline-flex cursor-help items-center gap-1.5 text-xs text-brand">
          <Repeat2 className="size-3.5 shrink-0" />
          Пересорт
        </span>
      </IconTooltip>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

/** Вкладка «История»: акты инвентаризации, в которых встречалась позиция. */
export function NomenclatureHistory({
  history,
  canViewResults,
  itemNoun,
}: {
  history: IngredientHistoryEntry[];
  /** Право `inventory.view_results`: без него в истории нет разниц и пометок. */
  canViewResults: boolean;
  itemNoun: string;
}) {
  const summary = useMemo(() => summarizeIngredientHistory(history), [history]);

  return (
    <ProfileSection
      title="История в актах"
      description={
        canViewResults
          ? "Разница фактическая, как насчитали по акту. Исключения и пересорт её не меняют, а отмечены в «Пометках»"
          : "Акты инвентаризации, в которых встречалась позиция"
      }
    >
      {history.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {itemNoun} пока не встречается в актах инвентаризации
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {canViewResults ? <HistorySummaryLine summary={summary} /> : null}
          {/* Горизонтальная прокрутка — внутри рамки, а не у страницы
              (docs/mobile-web.md): на телефоне колонки не сминаются. */}
          <div className="overflow-x-auto rounded-lg border">
            <table className={cn("w-full text-sm", canViewResults && "min-w-[620px]")}>
              <thead className="bg-muted text-xs font-medium text-muted-foreground">
                <tr className="h-11">
                  <th className="px-3 text-left font-medium">Акт</th>
                  <th className="px-3 text-left font-medium">Статус</th>
                  <th className="px-3 text-right font-medium">Факт</th>
                  <th className="px-3 text-right font-medium">Расчёт</th>
                  {canViewResults ? (
                    <>
                      <th className="px-3 text-right font-medium">Разница</th>
                      <th className="px-3 text-right font-medium">Сумма</th>
                      <th className="px-3 text-left font-medium">Пометки</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.documentId} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2.5">
                      <Link
                        href={
                          item.counted
                            ? `/documents/inventory/${item.documentId}/results`
                            : `/documents/inventory/${item.documentId}`
                        }
                        className="font-medium hover:underline"
                      >
                        {item.documentNumber}
                      </Link>
                      <div className="whitespace-nowrap text-xs text-muted-foreground">
                        <LocalDateTime value={item.invoiceDate} variant="date" />
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <InventoryStatusBadge status={item.status} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                      {formatInventoryQuantity(item.actualAmount, item.measureUnitName)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {formatInventoryQuantity(item.calculatedAmount, item.measureUnitName)}
                    </td>
                    {canViewResults ? (
                      <>
                        <td
                          className={cn(
                            "whitespace-nowrap px-3 py-2.5 text-right tabular-nums",
                            item.counted
                              ? signedAmountClass(item.differenceAmount)
                              : "text-muted-foreground",
                          )}
                        >
                          <HistoryDifference item={item} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">
                          {item.counted ? (
                            <Money value={item.differenceSum} signed />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <HistoryMarks item={item} />
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ProfileSection>
  );
}
