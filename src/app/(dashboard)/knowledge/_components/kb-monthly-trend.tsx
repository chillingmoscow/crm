import Link from "next/link";

import { cn } from "@/lib/utils";
import type { KbAnalyticsMonthlyPoint } from "@/lib/knowledge/analytics";

/**
 * Помесячный тренд активности — bar-chart за последние N месяцев.
 * Он же селектор месяца: клик по столбцу открывает дашборд за этот
 * месяц (`?month=YYYY-MM`). Активный месяц подсвечен; есть кнопка
 * сброса к скользящему периоду.
 *
 * Bar-chart строится layout'ом (flex items-end, высота столбца в %)
 * — без абсолютного позиционирования, по DS.
 */
export function KbMonthlyTrend({
  rows,
  activeMonthKey,
  basePath,
  query,
}: {
  rows: KbAnalyticsMonthlyPoint[];
  /** Выбранный месяц (если дашборд смотрят за конкретный месяц). */
  activeMonthKey?: string;
  basePath: string;
  /** Доп. query-параметры (p/view) без ведущего символа — чтобы
   *  выбор месяца / «← к периоду» не сбрасывали текущий
   *  период/вид (Codex #329 P2). */
  query?: string;
}) {
  const maxSeconds = Math.max(1, ...rows.map((r) => r.totalSeconds));
  const suffix = query ? `&${query}` : "";
  const periodHref = query ? `${basePath}?${query}` : basePath;

  return (
    <section className="flex flex-col rounded-xl border bg-card overflow-hidden">
      <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3.5">
        <h2 className="text-sm font-semibold text-foreground">
          Активность по месяцам
        </h2>
        {activeMonthKey ? (
          <Link
            href={periodHref}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← к периоду
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">
            суммарное время чтения · клик — за месяц
          </span>
        )}
      </div>

      <div className="flex items-end gap-1.5 px-4 pt-6 pb-3 h-48">
        {rows.map((r) => {
          const pct = Math.round((r.totalSeconds / maxSeconds) * 100);
          const isActive = r.monthKey === activeMonthKey;
          return (
            <Link
              key={r.monthKey}
              href={`${basePath}?month=${r.monthKey}${suffix}`}
              title={`${r.label}: ${formatDuration(r.totalSeconds)} · ${r.sessionCount} сессий · ${r.uniqueReaders} читателей`}
              className="group flex flex-1 flex-col items-center gap-1.5 min-w-0"
            >
              <span className="text-[10px] tabular-nums text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                {formatDuration(r.totalSeconds)}
              </span>
              <div className="flex w-full flex-1 items-end">
                <div
                  className={cn(
                    "w-full rounded-t transition-colors",
                    isActive
                      ? "bg-brand"
                      : "bg-brand/30 group-hover:bg-brand/55",
                  )}
                  style={{ height: `${Math.max(pct, 2)}%` }}
                  aria-hidden
                />
              </div>
              <span
                className={cn(
                  "truncate text-[11px] tabular-nums",
                  isActive
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {r.label}
                {r.isCurrent ? " ·" : ""}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin > 0 ? `${hours} ч ${remMin} мин` : `${hours} ч`;
}
