"use client";

import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const HOURS = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0"),
);
const MINUTES = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, "0"),
);

/**
 * KB time picker. Заменяет native `<input type="time">` (его OS-овый
 * dropdown не стилизуется). Триггер «HH:mm» + часы; попап — две
 * скролл-колонки (часы / минуты), выбранное = brand-акцент.
 * Значение всегда нормализуется к «HH:mm».
 */
export function TimePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hh = "00", mm = "00"] = value.split(":");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Время"
          className="flex h-8 w-full items-center justify-between rounded-md
                     border border-input bg-transparent px-2 text-[13px]
                     tabular-nums text-foreground outline-none transition-colors
                     hover:border-foreground/25 focus-visible:border-brand
                     focus-visible:ring-2 focus-visible:ring-brand/30
                     data-[state=open]:border-brand
                     data-[state=open]:ring-2 data-[state=open]:ring-brand/30"
        >
          {hh}:{mm}
          <Clock className="size-3.5 shrink-0 text-muted-foreground/60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-auto rounded-xl p-1.5"
      >
        <div className="flex gap-1">
          <TimeColumn
            items={HOURS}
            selected={hh}
            onSelect={(h) => onChange(`${h}:${mm}`)}
          />
          <TimeColumn
            items={MINUTES}
            selected={mm}
            onSelect={(m) => onChange(`${hh}:${m}`)}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TimeColumn({
  items,
  selected,
  onSelect,
}: {
  items: string[];
  selected: string;
  onSelect: (v: string) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  // Подскролл выбранного значения в центр при открытии попапа.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "center" });
  }, []);

  return (
    <div
      className="flex max-h-[208px] flex-col gap-0.5 overflow-y-auto px-0.5
                 [scrollbar-width:thin]"
    >
      {items.map((it) => {
        const isCurrent = it === selected;
        return (
          <button
            key={it}
            ref={isCurrent ? selectedRef : undefined}
            type="button"
            onClick={() => onSelect(it)}
            className={cn(
              "h-8 w-12 shrink-0 rounded-md text-[13px] tabular-nums",
              "transition-colors",
              isCurrent
                ? "bg-brand font-medium text-white"
                : "text-foreground hover:bg-accent",
            )}
          >
            {it}
          </button>
        );
      })}
    </div>
  );
}
