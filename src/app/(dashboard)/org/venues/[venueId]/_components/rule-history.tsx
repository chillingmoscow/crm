"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Свёрнутая история версий правил внутри секции настроек заведения:
 * кнопка «История правил · N» с `aria-expanded` вместо нативного `<details>`
 * (DS «Боковая панель»: нативный `<details>` в панелях и секциях не
 * используется). Содержимое — список под кнопкой.
 */
export function RuleHistory({
  count,
  label = "История правил",
  className,
  children,
}: {
  /** Число версий после подписи через « · »; без него — только подпись. */
  count?: number;
  label?: string;
  /** Обёртка: по умолчанию с линией сверху, как последний блок секции. */
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={className ?? "border-t pt-4"}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {count === undefined ? label : `${label} · ${count}`}
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      <div id={id} hidden={!open} className="pt-2">
        {children}
      </div>
    </div>
  );
}
