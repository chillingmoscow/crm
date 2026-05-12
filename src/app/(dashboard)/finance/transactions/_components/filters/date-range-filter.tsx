"use client";

import { useMemo, useState } from "react";
import { CalendarIcon, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { DatePicker } from "@/components/ui/date-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type DateRangeValue = { start: Date | null; end: Date | null };

type Props = {
  value: DateRangeValue;
  onChange: (next: DateRangeValue, presetLabel: string | null) => void;
  presetLabel: string | null;
};

type Preset = {
  label: string;
  range: () => DateRangeValue;
};

function buildPresets(): Preset[] {
  return [
    { label: "Сегодня",          range: () => ({ start: today(),                      end: today() }) },
    { label: "Вчера",            range: () => { const y = addDays(today(), -1); return { start: y, end: y }; } },
    { label: "Текущая неделя",   range: () => weekRange(0) },
    { label: "Текущий месяц",    range: () => monthRange(0) },
    { label: "Текущий квартал",  range: () => quarterRange(0) },
    { label: "Текущий год",      range: () => yearRange(0) },
    { label: "Прошлая неделя",   range: () => weekRange(-1) },
    { label: "Прошлый месяц",    range: () => monthRange(-1) },
    { label: "Прошлый квартал",  range: () => quarterRange(-1) },
    { label: "Прошлый год",      range: () => yearRange(-1) },
    { label: "Все время",        range: () => ({ start: null, end: null }) },
  ];
}

export function DateRangeFilter({ value, onChange, presetLabel }: Props) {
  const [open, setOpen] = useState(false);
  const presets = useMemo(buildPresets, []);

  const hasValue = value.start !== null || value.end !== null;

  const buttonText = (() => {
    if (presetLabel) return presetLabel;
    if (!hasValue) return "Период";
    if (value.start && value.end) return `${ddmm(value.start)} – ${ddmm(value.end)}`;
    if (value.start) return `С ${ddmm(value.start)}`;
    return `До ${ddmm(value.end!)}`;
  })();

  const clear = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onChange({ start: null, end: null }, null);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative inline-flex">
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "rounded-full h-8 pl-3 pr-8 font-normal text-sm",
              hasValue
                ? "bg-brand/10 border-brand/20 text-brand hover:bg-brand/15 hover:text-brand"
                : "bg-muted/60 border-transparent text-muted-foreground hover:bg-muted"
            )}
          >
            <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
            <span className="truncate max-w-[180px]">{buttonText}</span>
          </Button>
        </PopoverTrigger>
        {hasValue && (
          <button
            type="button"
            onClick={clear}
            aria-label="Сбросить даты"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-brand text-brand-foreground hover:bg-brand/90"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <PopoverContent align="start" className="w-auto p-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">С даты</label>
            <DatePicker
              value={isoDateInput(value.start)}
              onChange={(s) => {
                const d = s ? new Date(s) : null;
                if (d && value.end && d > value.end) onChange({ start: d, end: null }, null);
                else onChange({ start: d, end: value.end }, null);
              }}
              className="h-8"
              placeholder="—"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">До даты</label>
            <DatePicker
              value={isoDateInput(value.end)}
              onChange={(s) => {
                const d = s ? new Date(s) : null;
                if (d && value.start && d < value.start) onChange({ start: null, end: d }, null);
                else onChange({ start: value.start, end: d }, null);
              }}
              className="h-8"
              placeholder="—"
            />
          </div>
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-1.5">Быстрый выбор:</p>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => {
              const isActive = presetLabel === p.label;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    onChange(p.range(), p.label);
                    setOpen(false);
                  }}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-full border",
                    isActive
                      ? "bg-brand text-brand-foreground border-brand"
                      : "border-border hover:bg-accent"
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        <Calendar
          mode="range"
          numberOfMonths={2}
          selected={{
            from: value.start ?? undefined,
            to: value.end ?? undefined,
          }}
          onSelect={(r) => {
            onChange(
              { start: r?.from ?? null, end: r?.to ?? null },
              null
            );
          }}
          className="p-0"
        />

        <div className="flex justify-end pt-2 border-t">
          <Button
            size="sm"
            className="bg-brand hover:bg-brand/90"
            onClick={() => setOpen(false)}
          >
            Применить
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(d.getDate() + n);
  return r;
}

function weekRange(weeksOffset: number): DateRangeValue {
  const t = today();
  const dayIdx = (t.getDay() + 6) % 7;
  const monday = addDays(t, -dayIdx + weeksOffset * 7);
  const sunday = addDays(monday, 6);
  return { start: monday, end: sunday };
}

function monthRange(monthsOffset: number): DateRangeValue {
  const t = today();
  const start = new Date(t.getFullYear(), t.getMonth() + monthsOffset, 1);
  const end = new Date(t.getFullYear(), t.getMonth() + monthsOffset + 1, 0);
  return { start, end };
}

function quarterRange(quartersOffset: number): DateRangeValue {
  const t = today();
  const qStartMonth = Math.floor(t.getMonth() / 3) * 3 + quartersOffset * 3;
  const start = new Date(t.getFullYear(), qStartMonth, 1);
  const end = new Date(t.getFullYear(), qStartMonth + 3, 0);
  return { start, end };
}

function yearRange(yearsOffset: number): DateRangeValue {
  const t = today();
  const start = new Date(t.getFullYear() + yearsOffset, 0, 1);
  const end = new Date(t.getFullYear() + yearsOffset, 11, 31);
  return { start, end };
}

function ddmm(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function isoDateInput(d: Date | null): string {
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
