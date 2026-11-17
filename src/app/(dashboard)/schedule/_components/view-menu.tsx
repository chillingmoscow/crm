"use client";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type ScheduleView = "week" | "templates" | "list";

/** Иконка-кнопка в тулбаре расписания: выбор раскладки (по сотрудникам, по шаблонам, список). */
export function ViewMenu({
  value,
  onChange,
  canPlan,
}: {
  value: ScheduleView;
  onChange: (view: ScheduleView) => void;
  canPlan: boolean;
}) {
  const views: { value: ScheduleView; label: string }[] = [
    { value: "week", label: "По сотрудникам" },
    ...(canPlan ? [{ value: "templates" as const, label: "По шаблонам" }] : []),
    { value: "list", label: "Список" },
  ];
  const current = views.find((v) => v.value === value)?.label ?? views[0].label;
  return (
    <DropdownMenu>
      <Tooltip delayDuration={450}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            {/* Оформление как у TableIconButton в TableControls. */}
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={`Вид расписания: ${current}`}
              className="h-8 w-8 border-border text-muted-foreground hover:border-brand/40 hover:bg-background hover:text-foreground data-[state=open]:border-brand data-[state=open]:text-foreground sm:h-9 sm:w-9 [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4"
            >
              <Eye />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>Вид: {current.toLocaleLowerCase("ru")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Вид расписания</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as ScheduleView)}>
          {views.map((v) => (
            <DropdownMenuRadioItem key={v.value} value={v.value}>
              {v.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
