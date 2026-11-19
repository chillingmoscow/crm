"use client";

import { Fragment, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type TableSplitButtonOption = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
};

type TableSplitButtonProps = {
  label: string;
  icon?: ReactNode;
  onPrimaryClick: () => void;
  options: TableSplitButtonOption[];
  disabled?: boolean;
  primaryTooltip?: string;
  menuTooltip?: string;
  className?: string;
};

export function TableSplitButton({
  label,
  icon,
  onPrimaryClick,
  options,
  disabled,
  primaryTooltip,
  menuTooltip = "Дополнительные действия",
  className,
}: TableSplitButtonProps) {
  return (
    // Адаптив: на мобильном кнопка ниже/компактнее (h-8, px-2.5, text-xs),
    // чтобы вставать в один ряд с иконками-контролами таблицы; на sm+ —
    // обычный размер (h-9, text-sm).
    // Без overflow-hidden: углы скругляют сами половинки, а обрезка срезала бы
    // зону нажатия `touch-target` (44 px по высоте) и обводку фокуса.
    <div className={cn("inline-flex h-8 rounded-md shadow-sm sm:h-9", className)}>
      <Tooltip delayDuration={450}>
        <TooltipTrigger asChild>
          <Button
            type="button"
            className="touch-target h-8 rounded-none rounded-l-md border-r border-brand-foreground/20 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm"
            disabled={disabled}
            onClick={onPrimaryClick}
          >
            {icon ? <span className="flex h-4 w-4 items-center justify-center">{icon}</span> : null}
            {label}
          </Button>
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>
          {primaryTooltip ?? label}
        </TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <Tooltip delayDuration={450}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              {/* Стрелка вплотную к основной кнопке: зона 44×44 вокруг 32 px
                  залезла бы на неё. Поэтому на сенсорном экране стрелка сама
                  шириной 44, а `touch-target` добирает высоту. */}
              <Button
                type="button"
                className="touch-target h-8 w-8 rounded-none rounded-r-md px-0 sm:h-9 sm:w-9 [@media(pointer:coarse)]:w-11"
                disabled={disabled}
                aria-label={menuTooltip}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent sideOffset={6}>
            {menuTooltip}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-56">
          {options.map((option) => (
            <Fragment key={option.label}>
              {option.separatorBefore ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                disabled={option.disabled}
                onSelect={option.onSelect}
                className={cn(
                  "gap-2",
                  option.destructive ? "text-destructive focus:text-destructive" : null,
                )}
              >
                {option.icon ? (
                  <span className="flex h-4 w-4 items-center justify-center text-current [&_svg]:h-4 [&_svg]:w-4">
                    {option.icon}
                  </span>
                ) : null}
                {option.label}
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
