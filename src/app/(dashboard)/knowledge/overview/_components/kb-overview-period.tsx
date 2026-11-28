"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarDays, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MonthPicker } from "@/components/shared/month-picker";
import { PeriodStepper, periodTriggerClass } from "@/components/shared/period-stepper";
import {
  kbOverviewNextDisabled,
  kbOverviewPeriodLabel,
  kbOverviewPeriodQuery,
  parseKbOverviewPeriod,
  shiftKbOverviewPeriod,
  type KbOverviewPeriod,
} from "@/lib/knowledge/overview";
import { cn } from "@/lib/utils";

/** Первый месяц, который можно выбрать: раньше базы знаний не было. */
const MIN_MONTH = "2024-01-01";

/**
 * Период «Обзора»: чипы «Неделя / Месяц» и `PeriodStepper` (DS → «Показатели
 * и период»): стрелки шагают на период, середина открывает выбор, ghost
 * «Сегодня» возвращает к текущему. Период живёт в адресе
 * (`?period=week|month&from=…`), вид («По страницам») сохраняется.
 */
export function KbOverviewPeriod({ period, today }: { period: KbOverviewPeriod; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [weekOpen, setWeekOpen] = useState(false);

  const go = (next: KbOverviewPeriod) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of new URLSearchParams(kbOverviewPeriodQuery(next))) query.set(key, value);
    router.push(`${pathname}?${query.toString()}`, { scroll: false });
  };

  const current = parseKbOverviewPeriod({ period: period.kind, from: undefined }, today);
  const isCurrent = current.start === period.start;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Период" className="inline-flex h-9 items-center gap-1 rounded-md bg-muted/55 p-1">
        {(["week", "month"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={period.kind === kind}
            onClick={() => period.kind !== kind && go(parseKbOverviewPeriod({ period: kind }, today))}
            className={cn(
              "h-full whitespace-nowrap rounded-[6px] px-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm",
              period.kind === kind && "bg-background text-brand shadow-sm hover:text-brand",
            )}
          >
            {kind === "week" ? "Неделя" : "Месяц"}
          </button>
        ))}
      </div>

      <PeriodStepper
        previous={period.kind === "week" ? "Предыдущая неделя" : "Предыдущий месяц"}
        next={period.kind === "week" ? "Следующая неделя" : "Следующий месяц"}
        onPrevious={() => go(shiftKbOverviewPeriod(period, -1))}
        onNext={() => go(shiftKbOverviewPeriod(period, 1))}
        nextDisabled={kbOverviewNextDisabled(period, today)}
      >
        {period.kind === "month" ? (
          <MonthPicker
            variant="period"
            prefix=""
            ariaLabel="Месяц обзора"
            value={`${period.start}-01`}
            min={MIN_MONTH}
            max={`${today.slice(0, 7)}-01`}
            onChange={(month) => go({ kind: "month", start: month.slice(0, 7) })}
          />
        ) : (
          <Popover open={weekOpen} onOpenChange={setWeekOpen}>
            <PopoverTrigger asChild>
              <button type="button" className={periodTriggerClass} aria-label="Выбрать неделю обзора">
                <CalendarDays className="size-4 shrink-0" />
                <span className="whitespace-nowrap">{kbOverviewPeriodLabel(period)}</span>
                <ChevronDown className="size-3 shrink-0" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                locale={ru}
                weekStartsOn={1}
                defaultMonth={new Date(`${period.start}T12:00:00`)}
                selected={new Date(`${period.start}T12:00:00`)}
                disabled={{ after: new Date(`${today}T12:00:00`) }}
                onSelect={(date) => {
                  if (!date) return;
                  go(parseKbOverviewPeriod({ period: "week", from: format(date, "yyyy-MM-dd") }, today));
                  setWeekOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        )}
      </PeriodStepper>

      {!isCurrent && (
        <Button variant="ghost" size="sm" onClick={() => go(current)} aria-label={period.kind === "week" ? "Текущая неделя" : "Текущий месяц"}>
          Сегодня
        </Button>
      )}
    </div>
  );
}
