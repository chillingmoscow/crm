"use client";

import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * IconTooltip — мини-обёртка вокруг shadcn Tooltip для icon-кнопок.
 *
 * Зачем: native `title=""` показывается с системной задержкой 0.5–1 сек
 * и выглядит как родной tooltip ОС (вне нашей DS). Этот компонент даёт
 * Sheerly-look подсказку с короткой задержкой (~150 мс задаёт
 * TooltipProvider в dashboard layout), стрелка прячется глобальным
 * CSS (см. globals.css «BlockNote shadcn-tooltips» — селектор по
 * data-slot="tooltip-content" покрывает и shadcn-overlap).
 *
 * Использование:
 *   <IconTooltip label="Удалить страницу">
 *     <button>...</button>
 *   </IconTooltip>
 */
export function IconTooltip({
  label,
  description,
  children,
  side = "bottom",
}: {
  label: string;
  description?: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={6}>
        <div className="grid gap-0.5">
          <strong className="font-semibold leading-tight">{label}</strong>
          {description && (
            <span className="font-normal text-neutral-200 leading-tight">
              {description}
            </span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
