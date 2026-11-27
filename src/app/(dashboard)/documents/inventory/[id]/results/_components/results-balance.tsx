"use client";

import { ArrowRight } from "lucide-react";

import {
  formatSignedInventoryQuantity,
  formatSignedMoney,
  signedAmountClass,
  type AmountRoundingScale,
} from "@/lib/format/amount";
import { cn } from "@/lib/utils";

import {
  resultBalanceShares,
  type ResultDifferenceEntry,
} from "./results-table-utils";

const percent = (share: number) =>
  `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(share * 100)}%`;

/**
 * Недостача против излишка на одной оси. Цвета — `signedAmountClass` через
 * `bg-current`: тот же красный и зелёный, что у сумм, в обеих темах. Части
 * растут по очереди от левого края (`chart-bar-grow-x`, docs/motion.md).
 */
export function ResultsBalanceBar({
  shortfallSum,
  surplusSum,
  amountRoundingScale,
}: {
  /** Управленческая недостача (отрицательная или по модулю — неважно). */
  shortfallSum: number;
  surplusSum: number;
  amountRoundingScale: AmountRoundingScale;
}) {
  const shares = resultBalanceShares(shortfallSum, surplusSum);
  const net = Math.abs(surplusSum) - Math.abs(shortfallSum);
  return (
    <section className="rounded-lg border bg-card p-3 sm:p-4" aria-label="Недостача против излишка">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-medium text-muted-foreground">Недостача против излишка</h3>
        <span
          className={cn("text-sm font-medium tabular-nums", signedAmountClass(net))}
          data-tip="Итог по управленческой оценке: излишек минус недостача"
        >
          {formatSignedMoney(net, "RUB", amountRoundingScale)}
        </span>
      </div>
      {shares ? (
        <>
          <div
            className="mt-3 flex h-2.5 w-full gap-1"
            role="img"
            aria-label={`Недостача ${percent(shares.shortfall)}, излишек ${percent(shares.surplus)}`}
          >
            {shares.shortfall > 0 ? (
              <div className={signedAmountClass(-1)} style={{ flexGrow: shares.shortfall, flexBasis: 0, minWidth: 6 }}>
                <div className="chart-bar-grow-x h-full rounded-full bg-current" />
              </div>
            ) : null}
            {shares.surplus > 0 ? (
              <div className={signedAmountClass(1)} style={{ flexGrow: shares.surplus, flexBasis: 0, minWidth: 6 }}>
                <div
                  className="chart-bar-grow-x h-full rounded-full bg-current"
                  style={{ animationDelay: shares.shortfall > 0 ? "90ms" : undefined }}
                />
              </div>
            ) : null}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              Недостача <span className="font-medium tabular-nums text-foreground">{percent(shares.shortfall)}</span>
            </span>
            <span>
              Излишек <span className="font-medium tabular-nums text-foreground">{percent(shares.surplus)}</span>
            </span>
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Расхождений в деньгах нет</p>
      )}
    </section>
  );
}

/**
 * Пять позиций, которые дают самое большое расхождение в деньгах. Название —
 * ссылка на строку в таблице: страница таблицы переключается, строка
 * прокручивается в вид и подсвечивается.
 */
export function ResultsTopDifferences({
  entries,
  amountRoundingScale,
  onOpen,
}: {
  entries: ResultDifferenceEntry[];
  amountRoundingScale: AmountRoundingScale;
  onOpen: (id: string) => void;
}) {
  const max = Math.max(...entries.map((entry) => Math.abs(entry.sum)), 0);
  return (
    <section className="rounded-lg border bg-card p-3 sm:p-4" aria-label="Топ позиций по расхождению">
      <h3 className="text-xs font-medium text-muted-foreground">
        {entries.length > 1 ? `Топ-${entries.length} позиций по расхождению` : "Позиция с расхождением"}
      </h3>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Расхождений в деньгах нет</p>
      ) : (
        <ol className="mt-2 divide-y">
          {entries.map((entry, index) => (
            <li key={entry.id} className="py-2 first:pt-1 last:pb-0">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onOpen(entry.id)}
                  className="group flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm transition-colors duration-200 hover:text-brand focus-visible:outline-none focus-visible:text-brand"
                  data-tip={entry.name}
                  data-tip-sub="Показать строку в таблице"
                >
                  <span className="truncate">{entry.name}</span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-brand" />
                </button>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatSignedInventoryQuantity(entry.amount, entry.unit)}
                </span>
                <span
                  className={cn(
                    "w-28 shrink-0 text-right text-sm font-medium tabular-nums",
                    signedAmountClass(entry.sum),
                  )}
                >
                  {formatSignedMoney(entry.sum, "RUB", amountRoundingScale)}
                </span>
              </div>
              {/* Вес позиции относительно самой крупной — тонкой полоской. */}
              <div className={cn("mt-1.5 h-0.5 w-full", signedAmountClass(entry.sum))}>
                <div
                  className="chart-bar-grow-x h-full rounded-full bg-current opacity-50"
                  style={{
                    width: `${max > 0 ? Math.max(2, (Math.abs(entry.sum) / max) * 100) : 0}%`,
                    animationDelay: `${index * 90}ms`,
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
