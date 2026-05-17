import Link from "next/link";

import { cn } from "@/lib/utils";
import type { KbAnalyticsPeriod } from "@/lib/knowledge/analytics";

export type KbAnalyticsView = "overview" | "pages";

const TABS: { value: KbAnalyticsView; label: string }[] = [
  { value: "overview", label: "Обзор" },
  { value: "pages", label: "По страницам" },
];

/** Подчёркнутые табы вида аналитики (Обзор / По страницам) через
 *  ?view=. Сохраняет период. Дизайн — sheerly `hL8wQ` tabsRow. */
export function KbAnalyticsViewTabs({
  current,
  period,
  basePath,
}: {
  current: KbAnalyticsView;
  period: KbAnalyticsPeriod;
  basePath: string;
}) {
  return (
    <div className="flex items-center gap-6 border-b border-border">
      {TABS.map((tab) => {
        const isActive = tab.value === current;
        const viewQS = tab.value === "overview" ? "" : `&view=${tab.value}`;
        return (
          <Link
            key={tab.value}
            href={`${basePath}?p=${period}${viewQS}`}
            scroll={false}
            className={cn(
              "-mb-px border-b-2 px-0.5 py-2.5 text-sm transition-colors",
              isActive
                ? "border-foreground font-semibold text-foreground"
                : "border-transparent font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
