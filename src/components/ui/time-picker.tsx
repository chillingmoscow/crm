"use client";

import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

/** Shared styled HH:mm control, including the compact knowledge property view. */
export function TimePicker({ value, onChange, id, className, clearable = true, disabled = false }: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  className?: string;
  clearable?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hh = "00", mm = "00"] = value ? value.split(":") : [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button id={id} type="button" disabled={disabled} aria-label="Время" className={cn(
          "flex h-10 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
          className,
        )}>
          <Clock className="size-4 shrink-0 text-muted-foreground" />
          <span className={cn("truncate tabular-nums", !value && "text-muted-foreground")}>{value || "ЧЧ:ММ"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-auto p-2">
        <div className="flex gap-2">
          <TimeColumn label="Часы" items={HOURS} selected={value ? hh : undefined} onSelect={(h) => onChange(`${h}:${mm}`)} />
          <TimeColumn label="Минуты" items={MINUTES} selected={value ? mm : undefined} onSelect={(m) => onChange(`${hh}:${m}`)} />
        </div>
        <div className="mt-2 flex items-center justify-end gap-1 border-t pt-2">
          {clearable && value && <Button variant="ghost" size="sm" onClick={() => { onChange(""); setOpen(false); }}>Очистить</Button>}
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Готово</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
function TimeColumn({ label, items, selected, onSelect }: { label: string; items: string[]; selected?: string; onSelect: (value: string) => void }) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { selectedRef.current?.scrollIntoView({ block: "center" }); }, []);
  return (
    <div className="min-w-0">
      <p className="mb-1 text-center text-xs text-muted-foreground">{label}</p>
      <div role="group" aria-label={label} className="flex max-h-52 flex-col gap-0.5 overflow-y-auto px-0.5 [scrollbar-width:thin]">
        {items.map((item) => <button key={item} ref={item === selected ? selectedRef : undefined}
          type="button" aria-label={`${label}: ${item}`} aria-pressed={item === selected} onClick={() => onSelect(item)}
          className={cn("h-8 w-14 shrink-0 rounded-md text-sm tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", item === selected ? "bg-brand text-white" : "hover:bg-accent")}>
          {item}
        </button>)}
      </div>
    </div>
  );
}
