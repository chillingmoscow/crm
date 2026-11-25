"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Кнопка-счётчик входящих в ряду инструментов (design-system, «Кнопки»):
 * иконка и число, подпись — в подсказке, по нажатию — список во
 * всплывающем окне. Вид и размер — как у `TableIconButton` рядом, чтобы ряд
 * держал одну высоту; `TableIconButton` сам не умеет открывать окно.
 */
export function ToolbarCountButton({
  icon,
  count,
  label,
  open,
  onOpenChange,
  children,
  contentClassName,
}: {
  icon: ReactNode;
  count: number;
  /** Подпись подсказки: «Заявки на замену». Число к ней дописывается. */
  label: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  contentClassName?: string;
}) {
  const full = `${label}: ${count}`;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip delayDuration={450}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={full}
              className={cn(
                "touch-target h-8 gap-1 border-border px-2 text-muted-foreground hover:border-brand/40 hover:bg-background hover:text-foreground sm:h-9 sm:px-2.5",
                "[&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4",
                // Открытое окно — как активная иконка ряда. По aria-expanded, а не
                // data-state: data-state на кнопке перекрывает подсказка.
                "aria-expanded:border-brand aria-expanded:text-foreground aria-expanded:shadow-[0_0_0_2px_hsl(var(--brand)/0.16)]",
              )}
            >
              {icon}
              <span className="text-[13px] font-medium tabular-nums text-foreground">{count}</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>{full}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        className={cn("max-h-[70vh] w-96 max-w-[calc(100vw-32px)] overflow-y-auto p-3", contentClassName)}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
