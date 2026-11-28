"use client";

import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { fieldFocusClass, fieldInvalidClass } from "./field-styles";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

/** Shared styled HH:mm control, including the compact knowledge property view. */
export function TimePicker({ value, onChange, id, label, className, clearable = true, disabled = false, hideScrollbar = false, "aria-describedby": ariaDescribedBy, "aria-invalid": invalid }: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  /** Доступное имя поля («Начало», «Окончание»). С `id` и связанным `<Label htmlFor>` не нужно. */
  label?: string;
  className?: string;
  clearable?: boolean;
  disabled?: boolean;
  /** Колонки без полосы прокрутки (свойство «Дата» в базе знаний, замечание
   *  владельца 28.11.2026). По умолчанию тонкая полоса остаётся: на
   *  компьютере она подсказывает, что список часов длиннее видимого. */
  hideScrollbar?: boolean;
  /** Связь с подсказкой/ошибкой из `<Field>`; как у DatePicker, ошибка рисуется через `data-invalid`, `aria-required` не рендерится. */
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [hh = "00", mm = "00"] = value ? value.split(":") : [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button ref={trigger} id={id} type="button" disabled={disabled} aria-label={label ?? (id ? undefined : "Время")}
          aria-describedby={ariaDescribedBy} data-invalid={invalid || undefined} className={cn(
          "flex h-10 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          fieldFocusClass,
          fieldInvalidClass,
          className,
        )}>
          <Clock className="size-4 shrink-0 text-muted-foreground" />
          <span className={cn("truncate tabular-nums", !value && "text-muted-foreground")}>{value || "ЧЧ:ММ"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent portalContainer={trigger.current?.closest<HTMLElement>('[role="dialog"]')} align="start" sideOffset={6} className="w-auto p-2">
        <div className="flex gap-2">
          <TimeColumn label="Часы" items={HOURS} selected={value ? hh : undefined} onSelect={(h) => onChange(`${h}:${mm}`)} hideScrollbar={hideScrollbar} />
          <TimeColumn label="Минуты" items={MINUTES} selected={value ? mm : undefined} onSelect={(m) => onChange(`${hh}:${m}`)} hideScrollbar={hideScrollbar} />
        </div>
        <div className="mt-2 flex items-center justify-end gap-1 border-t pt-2">
          {clearable && value && <Button variant="ghost" size="sm" onClick={() => { onChange(""); setOpen(false); }}>Очистить</Button>}
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Готово</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
function TimeColumn({ label, items, selected, onSelect, hideScrollbar = false }: { label: string; items: string[]; selected?: string; onSelect: (value: string) => void; hideScrollbar?: boolean }) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { selectedRef.current?.scrollIntoView({ block: "center" }); }, []);
  return (
    <div className="min-w-0">
      <p className="mb-1 text-center text-xs text-muted-foreground">{label}</p>
      <div role="group" aria-label={label} className={cn("flex max-h-52 touch-pan-y flex-col gap-0.5 overflow-y-auto overscroll-y-contain px-0.5 [scrollbar-width:thin]", hideScrollbar && "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden")}>
        {items.map((item) => <button key={item} ref={item === selected ? selectedRef : undefined}
          type="button" aria-label={`${label}: ${item}`} aria-pressed={item === selected} onClick={() => onSelect(item)}
          className={cn("h-8 w-14 shrink-0 rounded-md text-sm tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", item === selected ? "bg-brand text-white" : "hover:bg-accent")}>
          {item}
        </button>)}
      </div>
    </div>
  );
}
