"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

import type { KbAnalyticsPeriod } from "@/lib/knowledge/analytics";

const TABS: { value: KbAnalyticsPeriod; label: string }[] = [
  { value: "day", label: "День" },
  { value: "week", label: "Неделя" },
  { value: "month", label: "Месяц" },
];

/** Period switcher через ?p=day|week|month. Server-component страница
 *  читает searchParam → ре-рендерит виджеты с новым окном. Чисто
 *  ссылочная навигация — без локального state, чтобы dashboard был
 *  shareable URL'ами и работал без JS. */
export function KbAnalyticsPeriodTabs({
  current,
  basePath,
}: {
  current: KbAnalyticsPeriod;
  basePath: string;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-border bg-card p-1">
      {TABS.map((tab) => {
        const isActive = tab.value === current;
        return (
          <Link
            key={tab.value}
            href={`${basePath}?p=${tab.value}`}
            scroll={false}
            className={cn(
              "rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
