import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import s from "./progress-ring.module.css";

/**
 * Кольцо прогресса 88px по DS («Кольцо 88px», docs/design-system.md):
 * дорожка `stroke-muted`, факт — `stroke-brand`, прогноз продолжением —
 * `stroke-brand/25` (тёмная тема `/35`). Дуги идут от верхней точки по
 * часовой стрелке. В центре — `children` (обычно процент).
 */
export function ProgressRing({
  ratio,
  forecast = null,
  children,
  label,
}: {
  /** Доля от 0 до 1; больше 1 — кольцо полное. null — пустая дорожка. */
  ratio: number | null;
  forecast?: number | null;
  children?: ReactNode;
  /** Подпись для экранного диктора, например «Прочитано 60 %». */
  label?: string;
}) {
  const fact = Math.min(100, Math.max(0, (ratio ?? 0) * 100));
  const ahead = forecast === null ? 0 : Math.min(100, Math.max(0, forecast * 100));
  return (
    <div className="relative size-[88px] shrink-0" role={label ? "img" : undefined} aria-label={label}>
      <svg viewBox="0 0 88 88" className="size-full -rotate-90" aria-hidden>
        <circle cx="44" cy="44" r="38" fill="none" strokeWidth="8" className="stroke-muted" />
        {ahead > fact && (
          <circle
            cx="44"
            cy="44"
            r="38"
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${ahead} 100`}
            className={cn(s.arc, s.ahead, "stroke-brand/25 dark:stroke-brand/35")}
          />
        )}
        {fact > 0 && (
          <circle
            cx="44"
            cy="44"
            r="38"
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${fact} 100`}
            className={cn(s.arc, "stroke-brand")}
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-base font-semibold">
        {children}
      </span>
    </div>
  );
}
