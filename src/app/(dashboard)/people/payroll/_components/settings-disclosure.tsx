"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Сворачиваемый подраздел внутри секции настроек оплаты. Кнопка с
 * `aria-expanded` вместо нативного `<details>` (DS «Боковая панель»: нативный
 * `<details>` в панелях и секциях не используется). Подразделы одного списка
 * разделены тонкой линией, после последнего линии нет.
 */
export function SettingsDisclosure({
  title,
  summary,
  defaultOpen = false,
  onOpenChange,
  children,
}: {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="border-t pt-4 first:border-t-0 first:pt-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpen(!open);
          onOpenChange?.(!open);
        }}
        className="flex w-full items-center justify-between gap-4 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          {summary && (
            <span className="mt-1 block text-[13px] text-muted-foreground">
              {summary}
            </span>
          )}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      <div id={id} hidden={!open} className="space-y-5 pt-5">
        {children}
      </div>
    </div>
  );
}
