import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

import { AnimatedMoney } from "@/components/shared/animated-money";
import { Metric, MetricStrip } from "@/components/shared/metric-strip";
import { formatRub } from "@/components/shared/money";
import { formatChange, relativeChange, type CompareMode } from "@/lib/finance/dashboard-compare";
import { periodLabel, parseIsoDay } from "@/lib/finance/dashboard-period";
import { signedAmountClass } from "@/lib/format/amount";
import { averageCheck, loadWeekMetrics, type WeekMetrics } from "@/lib/home/week";
import { cn } from "@/lib/utils";

import { BlockError } from "./section";

/**
 * Показатели недели по закрытым дням (с понедельника по вчера): оборот,
 * средний чек, расходы — `MetricStrip`, суммы досчитываются. Под числом одна строка сравнения с базой из переключателя
 * в шапке (прошлая неделя или год назад, по тому же числу дней). Посуточных
 * графиков здесь нет — решение владельца.
 */
export async function WeekBlock({ mode }: { mode: CompareMode }) {
  let data: WeekMetrics | null;
  try {
    data = await loadWeekMetrics(mode);
  } catch (error) {
    console.error("[home] week:", error);
    return <BlockError what="показатели недели" />;
  }
  if (!data) return null;
  const { sales, expense, base, started } = data;
  const today = parseIsoDay(data.cutoff) ?? new Date();
  // В понедельник закрытых дней нет — подпись без диапазона.
  const range = started ? periodLabel({ from: data.week.from, to: data.cutoff }, today) : null;
  const baseLabel = base?.label ?? null;
  const yearMode = mode === "year";
  const notStarted = "Неделя только началась";

  const salesHint = (current: number | null, before: number | null, empty?: string): ReactNode => {
    if (!sales) return null;
    if (!started) return notStarted;
    if (sales.error) return "Не удалось загрузить смены";
    if (sales.current.days === 0) return "Смен за неделю пока нет";
    if (current === null) return empty ?? null;
    return change(current, before, baseLabel, false, yearMode);
  };

  return (
    <MetricStrip label={range ? `Показатели недели: ${range}` : "Показатели недели"}>
      {sales ? (
        <Metric
          primary
          label={range ? `Оборот · ${range}` : "Оборот за неделю"}
          href="/sales/shifts"
          icon={<ArrowUpRight size={15} aria-hidden />}
          value={<AnimatedMoney value={!sales.error && sales.current.days ? sales.current.turnover : null} />}
          hint={salesHint(sales.current.turnover, sales.base?.days ? sales.base.turnover : null)}
        />
      ) : null}
      {sales ? (
        <Metric
          label="Средний чек"
          href="/sales/statistics"
          icon={<ArrowUpRight size={15} aria-hidden />}
          value={<AnimatedMoney value={sales.error ? null : averageCheck(sales.current)} />}
          hint={salesHint(
            averageCheck(sales.current),
            averageCheck(sales.base),
            "Нет данных о чеках гостей",
          )}
        />
      ) : null}
      {expense ? (
        <Metric
          label="Расходы"
          href={`/finance/transactions?${new URLSearchParams({
            type: "expense",
            date_from: data.week.from,
            date_to: started ? data.cutoff : data.week.from,
            venue_id: data.venueId,
          })}`}
          icon={<ArrowUpRight size={15} aria-hidden />}
          value={<AnimatedMoney value={expense.current} />}
          hint={
            !started
              ? notStarted
              : expense.error
                ? "Не удалось загрузить операции"
                : expense.current === null
                  ? null
                  : expense.baseError
                    ? "Не удалось загрузить сравнение"
                    : change(expense.current, expense.baseCount > 0 ? expense.base : null, baseLabel, true, yearMode)
          }
        />
      ) : null}
    </MetricStrip>
  );
}

/**
 * «+12% к 16–20 ноября». Цвет — по смыслу: рост расходов красный. Не с чем
 * сравнить — так и пишем, а не молчим. В подсказке — прежнее значение.
 */
function change(
  current: number,
  before: number | null,
  label: string | null,
  inverse: boolean,
  yearMode: boolean,
): ReactNode {
  const value = before === null ? null : relativeChange(current, before);
  if (!label || value === null)
    return yearMode ? "Год назад данных не было" : "На прошлой неделе данных не было";
  return (
    <span data-tip={`Было: ${formatRub(before)}`}>
      <span className={cn("tabular-nums", signedAmountClass(inverse ? -value : value))}>
        {formatChange(value)}
      </span>{" "}
      к {label}
    </span>
  );
}

export function weekColumns(permissions: Set<string>): number {
  return (permissions.has("sales.view_shifts") ? 2 : 0) + (permissions.has("finance.view_transactions") ? 1 : 0);
}
