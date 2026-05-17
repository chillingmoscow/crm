"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

import type { KbAnalyticsPeriod } from "@/lib/knowledge/analytics";

const TABS: { value: KbAnalyticsPeriod; label: string }[] = [
  { value: "day", label: "День" },
  { value: "week", label: "Неделя" },
  { value: "month", label: "Месяц" },
];

/** Segmented-переключатель периода через ?p=day|week|month.
 *  Ссылочная навигация (shareable URL, работает без JS). Сохраняет
 *  активный таб-вид через `view`. Дизайн — sheerly `hL8wQ`
 *  periodWrap: подложка secondary, активный сегмент — карточка. */
export function KbAnalyticsPeriodTabs({
  current,
  basePath,
  view,
}: {
  current: KbAnalyticsPeriod;
  basePath: string;
  /** Активный таб-вид (`overview` | `pages`) — сохраняем при смене
   *  периода. `overview` опускаем (значение по умолчанию). */
  view?: string;
}) {
  const viewQS = view && view !== "overview" ? `&view=${view}` : "";
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg bg-secondary p-[3px]">
      {TABS.map((tab) => {
        const isActive = tab.value === current;
        return (
          <Link
            key={tab.value}
            href={`${basePath}?p=${tab.value}${viewQS}`}
            scroll={false}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
