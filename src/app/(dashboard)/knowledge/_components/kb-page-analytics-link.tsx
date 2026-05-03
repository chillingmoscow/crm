import Link from "next/link";
import { BarChart3 } from "lucide-react";

import { IconTooltip } from "@/components/ui/icon-tooltip";

/**
 * Кнопка-ссылка «Аналитика страницы» в page-header. Открывает per-page
 * drill-down `/knowledge/analytics/[slug]` — список юзеров с суммарным
 * временем на странице. Видна только под `kb.view_analytics` (gated в
 * parent server-компоненте `[slug]/page.tsx`).
 */
export function KbPageAnalyticsLink({ slug }: { slug: string }) {
  return (
    <IconTooltip label="Аналитика страницы">
      <Link
        href={`/knowledge/analytics/${slug}`}
        aria-label="Открыть аналитику по странице"
        className="inline-flex items-center justify-center size-9 rounded-lg bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <BarChart3 className="w-[18px] h-[18px]" />
      </Link>
    </IconTooltip>
  );
}
