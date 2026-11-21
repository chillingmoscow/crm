"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PeriodStepper, periodTriggerClass } from "@/components/shared/period-stepper";
import {
  ALL_TIME,
  isBeforeMinPeriod,
  isFuturePeriod,
  PERIOD_MIN_YEAR,
  periodLabel,
  periodParam,
  shiftPeriod,
  type DirectoryPeriod,
  type PeriodKind,
} from "@/lib/finance/period";
import { cn } from "@/lib/utils";

const KINDS: { kind: PeriodKind; label: string }[] = [
  { kind: "month", label: "Месяц" },
  { kind: "quarter", label: "Квартал" },
  { kind: "year", label: "Год" },
  { kind: "all", label: "Всё время" },
];

const STEP_LABEL: Record<Exclude<PeriodKind, "all">, [string, string]> = {
  month: ["Предыдущий месяц", "Следующий месяц"],
  quarter: ["Предыдущий квартал", "Следующий квартал"],
  year: ["Предыдущий год", "Следующий год"],
};

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(2026, i, 1)))
    .replace(".", ""),
);
const QUARTERS = ["I квартал", "II квартал", "III квартал", "IV квартал"];

/**
 * Период активности справочника: капсула `PeriodStepper` (стрелки листают
 * месяц, квартал или год) и выбор вида периода во всплывающем окне. Рядом —
 * ghost «Всё время», когда период сужен. `today` приходит с сервера, чтобы
 * сервер и браузер считали край диапазона одинаково.
 */
export function DirectoryPeriodPicker({
  value,
  today,
  onChange,
  ariaLabel,
}: {
  value: DirectoryPeriod;
  today: string;
  onChange: (period: DirectoryPeriod) => void;
  /** Что считается за период, для чтения с экрана: «Период операций по статьям». */
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  // Вид, который открыт во всплывающем окне; при открытии — вид выбранного периода.
  const [kind, setKind] = useState<PeriodKind>(value.kind);
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(value.kind === "all" ? thisYear : value.year);

  const steps = value.kind === "all" ? null : STEP_LABEL[value.kind];
  const previous = shiftPeriod(value, -1);
  const next = shiftPeriod(value, 1);

  function pick(period: DirectoryPeriod) {
    onChange(period);
    setOpen(false);
  }

  const cell = (selected: boolean) =>
    cn(
      "rounded-md py-2 text-sm disabled:pointer-events-none disabled:opacity-30",
      selected ? "bg-brand text-white" : "hover:bg-muted",
    );

  const yearNav = (
    <div className="mb-3 flex items-center justify-between">
      <button
        type="button"
        aria-label="Предыдущий год"
        disabled={year <= PERIOD_MIN_YEAR}
        className="touch-target rounded-md p-1.5 hover:bg-muted disabled:opacity-30"
        onClick={() => setYear((y) => y - 1)}
      >
        <ChevronLeft size={16} />
      </button>
      <strong className="text-sm tabular-nums">{year}</strong>
      <button
        type="button"
        aria-label="Следующий год"
        disabled={year >= thisYear}
        className="touch-target rounded-md p-1.5 hover:bg-muted disabled:opacity-30"
        onClick={() => setYear((y) => y + 1)}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );

  const selectedParam = periodParam(value);

  return (
    <>
      <PeriodStepper
        previous={steps?.[0] ?? "Предыдущий период"}
        next={steps?.[1] ?? "Следующий период"}
        previousDisabled={value.kind === "all" || isBeforeMinPeriod(previous)}
        nextDisabled={value.kind === "all" || isFuturePeriod(next, today)}
        onPrevious={() => onChange(previous)}
        onNext={() => onChange(next)}
      >
        <Popover
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (nextOpen) {
              setKind(value.kind);
              setYear(value.kind === "all" ? thisYear : value.year);
            }
          }}
        >
          <PopoverTrigger asChild>
            <button type="button" className={periodTriggerClass} aria-label={`${ariaLabel}: ${periodLabel(value)}`}>
              <CalendarDays className="size-4 shrink-0" />
              <span className="whitespace-nowrap first-letter:uppercase">{periodLabel(value)}</span>
              <ChevronDown className="size-3 shrink-0" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-3">
            <div role="group" aria-label="Вид периода" className="mb-3 grid grid-cols-4 gap-0.5 rounded-md bg-muted p-0.5">
              {KINDS.map((item) => {
                const active = kind === item.kind;
                return (
                  <button
                    key={item.kind}
                    type="button"
                    aria-pressed={active}
                    className={cn(
                      "h-7 whitespace-nowrap rounded-[5px] px-1 text-[13px] font-medium transition-colors",
                      active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => (item.kind === "all" ? pick(ALL_TIME) : setKind(item.kind))}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            {kind === "month" ? (
              <>
                {yearNav}
                <div className="grid grid-cols-3 gap-1">
                  {MONTHS.map((label, index) => {
                    const period: DirectoryPeriod = { kind: "month", year, month: index + 1 };
                    return (
                      <button
                        key={label}
                        type="button"
                        disabled={isFuturePeriod(period, today)}
                        aria-pressed={selectedParam === periodParam(period)}
                        className={cell(selectedParam === periodParam(period))}
                        onClick={() => pick(period)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : kind === "quarter" ? (
              <>
                {yearNav}
                <div className="grid grid-cols-2 gap-1">
                  {QUARTERS.map((label, index) => {
                    const period: DirectoryPeriod = { kind: "quarter", year, quarter: index + 1 };
                    return (
                      <button
                        key={label}
                        type="button"
                        disabled={isFuturePeriod(period, today)}
                        aria-pressed={selectedParam === periodParam(period)}
                        className={cell(selectedParam === periodParam(period))}
                        onClick={() => pick(period)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : kind === "all" ? (
              <p className="px-1 py-2 text-sm text-muted-foreground">
                Считаются все операции. Выберите месяц, квартал или год, чтобы сузить период
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-1">
                {Array.from({ length: thisYear - PERIOD_MIN_YEAR + 1 }, (_, i) => thisYear - i).map((y) => {
                  const period: DirectoryPeriod = { kind: "year", year: y };
                  return (
                    <button
                      key={y}
                      type="button"
                      aria-pressed={selectedParam === periodParam(period)}
                      className={cn(cell(selectedParam === periodParam(period)), "tabular-nums")}
                      onClick={() => pick(period)}
                    >
                      {y}
                    </button>
                  );
                })}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </PeriodStepper>
      {value.kind !== "all" ? (
        <Button variant="ghost" size="sm" onClick={() => onChange(ALL_TIME)}>
          Всё время
        </Button>
      ) : null}
    </>
  );
}
