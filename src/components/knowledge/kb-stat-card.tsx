import { cn } from "@/lib/utils";

export type KbStatTone = "muted" | "positive" | "warning";

const TONE_CLASS: Record<KbStatTone, string> = {
  muted: "text-muted-foreground",
  positive: "text-green-600 dark:text-green-400",
  warning: "text-orange-600 dark:text-orange-400",
};

/** KPI-карточка дашбордов KB (аналитика, дашборд менеджера).
 *  Дизайн — sheerly.pen `hL8wQ`/`TvInj` statsRow: label 12/muted,
 *  крупное tabular-значение, опц. подпись с тоном. */
export function KbStatCard({
  label,
  value,
  hint,
  hintTone = "muted",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  hintTone?: KbStatTone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-1.5 rounded-xl border bg-card px-[18px] py-4",
        className,
      )}
    >
      <span className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <span className="text-[26px] font-bold leading-none tracking-tight tabular-nums text-foreground">
        {value}
      </span>
      {hint != null && (
        <span
          className={cn(
            "text-[11px] font-semibold",
            TONE_CLASS[hintTone],
          )}
        >
          {hint}
        </span>
      )}
    </div>
  );
}
