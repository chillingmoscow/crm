"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale/ru";
import { Calendar as CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type DateRangeValue = {
  /** ISO date (YYYY-MM-DD) of the range start, or null. */
  from: string | null;
  /** ISO date (YYYY-MM-DD) of the range end, or null. */
  to: string | null;
};

type Props = {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

const NULL_RANGE: DateRangeValue = { from: null, to: null };

/**
 * Lightweight date-range picker. Uses react-day-picker (mode="range").
 * Emits ISO date strings (`YYYY-MM-DD`) to keep callers serialisable.
 *
 * Empty selection is supported — passing `{ from: null, to: null }`
 * clears the picker and shows the placeholder.
 */
export function DateRangePicker({
  value,
  onChange,
  placeholder = "Выберите период",
  disabled,
  className,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);

  const dpValue: DateRange | undefined =
    value.from || value.to
      ? {
          from: value.from ? parseISO(value.from) : undefined,
          to:   value.to   ? parseISO(value.to)   : undefined,
        }
      : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={ariaLabel ?? "Период"}
          className={cn(
            "w-full justify-start font-normal",
            !value.from && !value.to && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          <span className="truncate">{formatRange(value, placeholder)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          locale={ru}
          numberOfMonths={2}
          defaultMonth={dpValue?.from}
          selected={dpValue}
          onSelect={(next) => {
            if (!next || (!next.from && !next.to)) {
              onChange(NULL_RANGE);
              return;
            }
            onChange({
              from: next.from ? toIsoDate(next.from) : null,
              to:   next.to   ? toIsoDate(next.to)   : null,
            });
          }}
        />
        {(value.from || value.to) && (
          <div className="flex items-center justify-end gap-2 border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange(NULL_RANGE);
                setOpen(false);
              }}
            >
              Сбросить
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Готово
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toIsoDate(d: Date): string {
  // Local YYYY-MM-DD — treat the picker as date-only; do not coerce to UTC.
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatRange(value: DateRangeValue, placeholder: string): string {
  if (!value.from && !value.to) return placeholder;
  const from = value.from ? format(parseISO(value.from), "d MMM y", { locale: ru }) : "…";
  const to   = value.to   ? format(parseISO(value.to),   "d MMM y", { locale: ru }) : "…";
  return `${from} — ${to}`;
}
