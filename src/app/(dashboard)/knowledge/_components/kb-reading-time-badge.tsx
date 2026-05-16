import { Clock } from "lucide-react";

import { cn } from "@/lib/utils";

interface KbReadingTimeBadgeProps {
  minutes: number;
  /** Размер: `sm` для inline / search-result rows, `md` для page-header. */
  size?: "sm" | "md";
  className?: string;
}

/**
 * Pill «≈ N мин чтения» рядом с заголовком / в required-banner /
 * search-result rows. Notion-style: маленькая иконка + duration.
 *
 * Sprint D / Phase 2 plan §2.9.
 */
export function KbReadingTimeBadge({
  minutes,
  size = "md",
  className,
}: KbReadingTimeBadgeProps) {
  const isSm = size === "sm";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-muted-foreground",
        isSm ? "text-[11px]" : "text-xs",
        className,
      )}
      data-tip={`Примерное время чтения: ${minutes} мин`}
    >
      <Clock className={cn(isSm ? "size-3" : "size-3.5")} />
      <span className="tabular-nums">≈ {minutes} мин</span>
    </span>
  );
}
