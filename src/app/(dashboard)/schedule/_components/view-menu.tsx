"use client";
import { useState } from "react";
import { Check, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type ScheduleView = "week" | "templates" | "list";

/**
 * Иконка-кнопка в тулбаре расписания: выбор раскладки. Список оформлен
 * как варианты у чипов фильтров (TableFilterChip), чтобы выпадашки
 * на странице выглядели одинаково.
 */
export function ViewMenu({
  value,
  onChange,
  canPlan,
}: {
  value: ScheduleView;
  onChange: (view: ScheduleView) => void;
  canPlan: boolean;
}) {
  const [open, setOpen] = useState(false);
  const views: { value: ScheduleView; label: string }[] = [
    { value: "week", label: "По сотрудникам" },
    ...(canPlan ? [{ value: "templates" as const, label: "По шаблонам" }] : []),
    { value: "list", label: "Список" },
  ];
  const current = views.find((v) => v.value === value)?.label ?? views[0].label;
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
              aria-label={`Вид расписания: ${current}`}
              className={cn(
                "h-8 w-8 border-border text-muted-foreground hover:border-brand/40 hover:bg-background hover:text-foreground sm:h-9 sm:w-9 [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4",
                open && "border-brand text-foreground shadow-[0_0_0_2px_hsl(var(--brand)/0.16)]",
              )}
            >
              <Eye />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>Вид: {current.toLocaleLowerCase("ru")}</TooltipContent>
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
        <div role="group" aria-label="Вид расписания">
          {views.map((v) => (
            <button
              key={v.value}
              type="button"
              aria-pressed={v.value === value}
              onClick={() => {
                onChange(v.value);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-sm px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent",
                v.value === value && "bg-accent",
              )}
            >
              {v.label}
              {v.value === value && <Check className="size-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
