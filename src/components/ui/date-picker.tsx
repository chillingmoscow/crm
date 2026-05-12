"use client";

import * as React from "react";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { ru } from "date-fns/locale";

import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * DatePicker — наш собственный пикер дат вместо нативного
 * `<input type="date">`. Триггер по стилю совпадает с `<Input>`
 * (border / radius / padding / focus-ring), внутри — shadcn Calendar
 * с ru-локалью, поверх — Popover.
 *
 * Контролируемый API: `value` / `onChange` принимают/отдают
 * `YYYY-MM-DD` строку (пустая строка = «не выбрано»). Формат
 * совпадает с тем, что отдавал нативный `type="date"` —
 * существующие call-site'ы (react-hook-form `register`, server actions,
 * url-фильтры) работают без изменений.
 *
 * @example
 * ```tsx
 * <DatePicker
 *   id="birth_date"
 *   value={value}
 *   onChange={(v) => setValue("birth_date", v)}
 *   placeholder="Выберите дату"
 * />
 * ```
 */
export interface DatePickerProps {
  /** YYYY-MM-DD или пустая строка (= ничего не выбрано). */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Read-only — нельзя открыть popover. Стилизуется как наш `<Input>` readOnly. */
  readOnly?: boolean;
  /** Дополнительные классы триггера. */
  className?: string;
  /** Минимально допустимая дата (включительно). */
  fromDate?: Date;
  /** Максимально допустимая дата (включительно). */
  toDate?: Date;
  /** Год, с которого начинается выпадашка в Calendar. По умолчанию 1900. */
  startYear?: number;
  /** Год, которым заканчивается выпадашка. По умолчанию current + 5. */
  endYear?: number;
  /** Показать кнопку очистки. По умолчанию true (если value не пустой). */
  clearable?: boolean;
}

function parseISO(value: string): Date | undefined {
  if (!value) return undefined;
  // Локальная дата — без UTC-сдвига (Date(value) интерпретирует
  // YYYY-MM-DD как UTC, и в МСК / других +N таймзонах это даёт
  // вчерашний день).
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return undefined;
  return dt;
}

function formatISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDisplay(value: string): string {
  const d = parseISO(value);
  if (!d) return "";
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function DatePicker({
  value,
  onChange,
  id,
  name,
  placeholder = "Выберите дату",
  disabled,
  readOnly,
  className,
  fromDate,
  toDate,
  startYear = 1900,
  endYear,
  clearable = true,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selected = parseISO(value);
  const display = formatDisplay(value);
  const isInteractive = !disabled && !readOnly;

  const effectiveEndYear =
    endYear ?? new Date().getFullYear() + 5;

  // Стилизация триггера повторяет shadcn `<Input>`: тот же h-10 (если
  // не передан className), border, radius, focus-ring, padding.
  // Текст выравниваем по левому краю; иконка справа.
  const triggerClassName = cn(
    "relative flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm",
    "ring-offset-background transition-colors",
    "placeholder:text-muted-foreground",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    // readOnly: visually = native readOnly input (bg-muted) но НЕ
    // dimmed как disabled (opacity сохраняется 100%).
    readOnly && "bg-muted/50 cursor-default",
    // disabled — настоящий disabled (browser-style: dim + not-allowed).
    disabled && "opacity-50 cursor-not-allowed",
    className,
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!isInteractive) return;
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled || readOnly}
          className={triggerClassName}
        >
          <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
          <span
            className={cn(
              "ml-2 flex-1 text-left truncate",
              !display && "text-muted-foreground",
            )}
          >
            {display || placeholder}
          </span>
          {clearable && display && isInteractive && (
            <span
              role="button"
              aria-label="Очистить дату"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="ml-1 -mr-1 inline-flex size-6 items-center justify-center rounded-full text-muted-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="size-3.5" />
            </span>
          )}
          {/* Скрытый input для form-submit'а — Forms собирают value
              через name (если переданы в Controller, не нужно). */}
          {name && <input type="hidden" name={name} value={value} />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-0"
        sideOffset={6}
      >
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            if (!d) {
              onChange("");
            } else {
              onChange(formatISO(d));
            }
            setOpen(false);
          }}
          locale={ru}
          captionLayout="dropdown"
          startMonth={new Date(startYear, 0)}
          endMonth={new Date(effectiveEndYear, 11)}
          disabled={
            fromDate || toDate
              ? (d) =>
                  (fromDate ? d < fromDate : false) ||
                  (toDate ? d > toDate : false)
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  );
}
