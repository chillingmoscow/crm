"use client";
import { SalesTrend } from "@/components/shared/sales-trend";
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
export function StatisticsChart({ rows }: { rows: StatisticsRow[] }) {
  return (
    <SalesTrend
      series={Object.fromEntries(
        Object.entries(metrics).map(([key, [label, unit]]) => [
          key,
          { label, unit, points: statisticsSeries(rows, key) },
        ]),
      )}
    />
  );
}
