"use client";

import type { CompareMode } from "@/lib/finance/dashboard-compare";
import { cn } from "@/lib/utils";

/**
 * С чем сравнивать итоги — чипы-сегменты (DS → «Вкладки»: переключение
 * представлений без второго ряда вкладок). Один выбор вместо двух строк
 * сравнения под каждым показателем. Стоит в шапке страницы: финансовый
 * дашборд, главная «Сегодня».
 */
export function CompareSwitch({
  value,
  previousLabel,
  onChange,
  disabled = false,
}: {
  value: CompareMode;
  /** «Прошлый месяц», «Прошлая неделя» — см. `previousPeriodLabel`. */
  previousLabel: string;
  onChange: (mode: CompareMode) => void;
  disabled?: boolean;
}) {
  const options: { mode: CompareMode; label: string }[] = [
    { mode: "previous", label: previousLabel },
    { mode: "year", label: "Прошлый год" },
  ];
  return (
    <div
      role="group"
      aria-label="Сравнивать итоги с"
      className="inline-flex h-9 items-center gap-1 rounded-md bg-muted/55 p-1"
    >
      {options.map((o) => (
        <button
          key={o.mode}
          type="button"
          aria-pressed={value === o.mode}
          disabled={disabled}
          onClick={() => value !== o.mode && onChange(o.mode)}
          className={cn(
            "h-full whitespace-nowrap rounded-[6px] px-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none sm:text-sm",
            value === o.mode && "bg-background text-brand shadow-sm hover:text-brand",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
