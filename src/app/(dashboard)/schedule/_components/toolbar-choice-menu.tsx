"use client";
import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Иконка-кнопка в тулбаре расписания с выбором одного варианта: вид,
 * сортировка. Список оформлен как варианты у чипов фильтров
 * (TableFilterChip) — «Выпадающий список вариантов» в дизайн-системе.
 */
export function ToolbarChoiceMenu<T extends string>({
  icon,
  label,
  options,
  value,
  onChange,
}: {
  icon: ReactNode;
  /** Что выбирается: «Вид расписания», «Сортировка». */
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? options[0]?.label ?? "";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip delayDuration={450}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            {/* Оформление как у TableIconButton в TableControls. */}
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={`${label}: ${current}`}
              className={cn(
                "touch-target h-8 w-8 border-border text-muted-foreground hover:border-brand/40 hover:bg-background hover:text-foreground sm:h-9 sm:w-9 [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4",
                open && "border-brand text-foreground shadow-[0_0_0_2px_hsl(var(--brand)/0.16)]",
              )}
            >
              {icon}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>
          {label}: {current.toLocaleLowerCase("ru")}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (event.target instanceof HTMLElement) event.target.focus({ preventScroll: true });
        }}
        className="w-56 max-w-[calc(100vw-24px)] p-1"
      >
        <div role="group" aria-label={label}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent",
                option.value === value && "bg-accent",
              )}
            >
              {option.label}
              {option.value === value && <Check className="size-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
