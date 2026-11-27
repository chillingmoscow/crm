"use client";
import { SalesTrend } from "@/components/shared/sales-trend";
import { formatDayMonth } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import {
  statisticsSeries,
  type StatisticsRow,
} from "@/lib/sales/statistics-view";
const metrics = {
  turnover: ["Оборот", "₽"],
  tips_total: ["Чаевые", "₽"],
  averageCheck: ["Средний чек", "₽"],
  alcoholRevenue: ["Продажи алкоголя", "₽"],
  alcoholShare: ["Доля алкоголя", "%"],
  regularRevenue: ["Оборот постоянных гостей", "₽"],
  regularShare: ["Доля постоянных гостей", "%"],
} as const;

/** Вторая строка подсказки столбца: неполный месяц — честно, по какую дату. */
function pointNote(row: StatisticsRow | undefined, key: string) {
  const v = row?.values[key];
  if (!v || v.value == null) return null;
  if (v.total != null && v.known != null && v.known < v.total)
    return `По ${v.known} из ${countRu(v.total, "смены", "смен", "смен")}`;
  if (v.through) return `По ${formatDayMonth(v.through)}`;
  return null;
}

export function StatisticsChart({
  rows,
  currentMonth,
}: {
  rows: StatisticsRow[];
  /** Текущий месяц заведения («2026-11»): его столбец выделен. */
  currentMonth: string;
}) {
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return (
    <SalesTrend
      highlight={currentMonth}
      series={Object.fromEntries(
        Object.entries(metrics).map(([key, [label, unit]]) => [
          key,
          {
            label,
            unit,
            points: statisticsSeries(rows, key).map((p) => ({
              ...p,
              note: pointNote(byMonth.get(p.month), key),
            })),
          },
        ]),
      )}
    />
  );
}
