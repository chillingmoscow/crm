import Link from "next/link";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import type { KbAnalyticsTopPage } from "@/lib/knowledge/analytics";

/** Топ-страниц по суммарному времени. Server-component, рендерится
 *  внутри /knowledge/analytics/page.tsx. Click на строку → переход
 *  на саму страницу (drill-down с per-user разбивкой пока отложен —
 *  будет в следующей итерации Phase 1.3.5). */
export function KbAnalyticsTopPages({
  rows,
}: {
  rows: KbAnalyticsTopPage[];
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 px-2">
        За выбранный период никто не открывал страницы.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-px">
      {rows.map((row, idx) => (
        <li
          key={row.page_id}
          className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent transition-colors"
        >
          <span className="w-5 text-right text-xs font-mono tabular-nums text-muted-foreground">
            {idx + 1}.
          </span>
          <KbPageIcon icon={row.icon} color={row.icon_color} size={18} />
          <Link
            href={`/knowledge/${row.slug}`}
            className="flex-1 truncate text-sm font-medium hover:underline"
          >
            {row.title || "Без названия"}
          </Link>
          <span className="hidden md:inline text-xs text-muted-foreground tabular-nums">
            {row.unique_viewers} чел · {row.session_count} сессий
          </span>
          <span className="w-20 text-right text-sm font-medium tabular-nums">
            {formatDuration(row.total_seconds)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}с`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}м`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin > 0 ? `${hours}ч ${remMin}м` : `${hours}ч`;
}
