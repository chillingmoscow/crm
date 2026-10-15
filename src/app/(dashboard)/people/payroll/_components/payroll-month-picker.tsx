"use client";

import { useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const months = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(2026, i, 1)))
    .replace(".", ""),
);
export function PayrollMonthPicker({
  value,
  onChange,
  min,
  employee,
  disabled = false,
  prefix = "За ",
  ariaLabel,
  variant = "inline",
}: {
  value: string;
  onChange: (month: string) => void;
  min: string;
  employee?: string;
  disabled?: boolean;
  prefix?: string;
  ariaLabel?: string;
  variant?: "inline" | "field";
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setYear(Number(value.slice(0, 4)));
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel ?? `За какой месяц: ${employee}`}
          className={variant === "field" ? "inline-flex h-10 w-full items-center gap-2 rounded-lg border bg-background px-3 text-[13px] font-normal text-foreground hover:bg-muted disabled:opacity-50" : "mt-2 inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 text-xs font-normal text-foreground hover:bg-muted disabled:opacity-50"}
        >
          <CalendarDays size={12} className="text-muted-foreground" />
          {prefix}
          {new Date(`${value}T12:00:00Z`)
            .toLocaleDateString("ru-RU", {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            })
            .replace(" г.", "")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus({ preventScroll: true });
        }}
        align="start"
        className="w-64 p-3 focus:outline-none"
      >
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            aria-label="Предыдущий год"
            disabled={year <= Number(min.slice(0, 4))}
            className="rounded p-1.5 hover:bg-muted disabled:opacity-30"
            onClick={() => setYear((y) => y - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <strong className="text-sm">{year}</strong>
          <button
            type="button"
            aria-label="Следующий год"
            disabled={year >= 9999}
            className="rounded p-1.5 hover:bg-muted"
            onClick={() => setYear((y) => y + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {months.map((label, index) => {
            const date = `${String(year).padStart(4, "0")}-${String(index + 1).padStart(2, "0")}-01`;
            return (
              <button
                type="button"
                key={date}
                disabled={date < min}
                aria-pressed={value === date}
                className={`rounded-md py-2 text-sm disabled:opacity-30 ${value === date ? "bg-brand text-white" : "hover:bg-muted"}`}
                onClick={() => {
                  onChange(date);
                  setOpen(false);
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
