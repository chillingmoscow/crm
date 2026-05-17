"use client";

import { useState } from "react";
import { ru } from "date-fns/locale";

import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  quickDateISO,
  formatPropertyDate,
  type QuickDate,
} from "./date-control-helpers";

function parseISO(value: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const QUICK: { kind: QuickDate; label: string; brand?: boolean }[] = [
  { kind: "today", label: "Сегодня" },
  { kind: "tomorrow", label: "Завтра" },
  { kind: "in7", label: "Через 7 дней", brand: true },
];

/**
 * KB date-property control. sheerly.pen → rS3Ej.
 * Триггер: «15 апр. 2026 г.» либо «—». Popover: быстрые чипы +
 * Calendar (наш shadcn, ru) + футер «Без даты» / «Выбрать сегодня».
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
  const selected = parseISO(value ?? "");
  const display = formatPropertyDate(value);

  if (!canEdit) {
    return (
      <span className="text-[13px] tabular-nums">{display || "—"}</span>
    );
  }

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
                onChange(quickDateISO(q.kind));
                setOpen(false);
              }}
              className={cn(
                "h-7 rounded-md px-2.5 text-[13px] font-medium transition-colors",
                q.brand
                  ? "text-brand hover:bg-brand/10"
                  : "bg-secondary text-foreground hover:bg-accent",
              )}
            >
              {q.label}
            </button>
          ))}
        </div>
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            onChange(d ? toISO(d) : null);
            setOpen(false);
          }}
          locale={ru}
          showOutsideDays
          className="p-0"
          classNames={{
            caption_label:
              "select-none text-sm font-semibold text-brand bg-brand/10 rounded-full px-2.5 py-1",
            button_previous:
              "h-7 w-7 rounded-md bg-secondary hover:bg-accent inline-flex items-center justify-center",
            button_next:
              "h-7 w-7 rounded-md bg-secondary hover:bg-accent inline-flex items-center justify-center",
          }}
        />
        <div className="flex items-center justify-between pt-2 text-[13px]">
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Без даты
          </button>
          <button
            type="button"
            onClick={() => {
              onChange(quickDateISO("today"));
              setOpen(false);
            }}
            className="font-medium text-brand hover:underline"
          >
            Выбрать сегодня
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
