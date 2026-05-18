"use client";

import { useState } from "react";
import { ru } from "date-fns/locale";

import { Calendar } from "@/components/ui/calendar";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  quickDateISO,
  formatPropertyDate,
  splitDateValue,
  joinDateValue,
  toISO,
  type QuickDate,
} from "./date-control-helpers";

function parseISO(value: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

const QUICK: { kind: QuickDate; label: string }[] = [
  { kind: "today", label: "Сегодня" },
  { kind: "tomorrow", label: "Завтра" },
  { kind: "in7", label: "Через 7 дней" },
];

/**
 * KB date-property control. sheerly.pen → rS3Ej (адаптировано).
 * Триггер: «15 апр. 2026 г.» (+ «, HH:mm» если задано время) либо «—».
 * Попап: быстрые чипы (нейтральные) + Calendar (ru) + переключатель
 * «Время» + футер «Без даты». Единственный акцент — выбранный день.
 * Общий <Calendar> НЕ трогаем — только обёртка/оверрайды этого попапа.
 */
export function DateValueControl({
  value,
  canEdit,
  onChange,
}: {
  value: string | null;
  canEdit: boolean;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const { date: dateStr, time } = splitDateValue(value);
  const selected = parseISO(dateStr);
  const display = formatPropertyDate(value);

  if (!canEdit) {
    return (
      <span className="text-[13px] tabular-nums">{display || "—"}</span>
    );
  }

  const commitDate = (d: string) => {
    onChange(joinDateValue(d, time));
  };

  const toggleTime = (on: boolean) => {
    if (on) {
      const base = dateStr || quickDateISO("today");
      onChange(joinDateValue(base, nowTime()));
    } else {
      onChange(dateStr ? joinDateValue(dateStr, null) : null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="min-h-7 inline-flex items-center text-left text-[13px] tabular-nums
                     rounded px-1 border border-transparent transition-colors
                     hover:border-input data-[state=open]:border-input
                     text-muted-foreground/50 data-[has-value=true]:text-foreground"
          data-has-value={display ? "true" : "false"}
          aria-label="Дата"
        >
          {display || "—"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-auto p-3 rounded-xl"
      >
        <div className="flex flex-wrap items-center gap-1.5 pb-2">
          {QUICK.map((q) => (
            <button
              key={q.kind}
              type="button"
              onClick={() => {
                commitDate(quickDateISO(q.kind));
                setOpen(false);
              }}
              className="h-7 rounded-md bg-secondary px-2.5 text-[13px] font-medium
                         text-foreground transition-colors hover:bg-accent"
            >
              {q.label}
            </button>
          ))}
        </div>
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            if (d) {
              commitDate(toISO(d));
              setOpen(false);
            }
          }}
          locale={ru}
          showOutsideDays
          className="p-0"
          classNames={{
            caption_label: "select-none text-sm font-semibold text-foreground",
            button_previous:
              "h-7 w-7 rounded-md text-muted-foreground hover:bg-accent inline-flex items-center justify-center",
            button_next:
              "h-7 w-7 rounded-md text-muted-foreground hover:bg-accent inline-flex items-center justify-center",
          }}
        />
        <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
          <label
            htmlFor="kb-date-time-toggle"
            className="text-[13px] text-foreground"
          >
            Время
          </label>
          <Switch
            id="kb-date-time-toggle"
            checked={time !== null}
            onCheckedChange={toggleTime}
            aria-label="Добавить время"
          />
        </div>
        {time !== null && (
          <input
            type="time"
            value={time}
            onChange={(e) =>
              onChange(
                joinDateValue(
                  dateStr || quickDateISO("today"),
                  e.target.value || null,
                ),
              )
            }
            className="mt-2 h-8 w-full rounded-md border border-input bg-transparent
                       px-2 text-[13px] tabular-nums outline-none
                       focus:border-brand focus:ring-2 focus:ring-brand/30"
            aria-label="Время"
          />
        )}
        <div className="mt-3 border-t border-border pt-2">
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Без даты
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
