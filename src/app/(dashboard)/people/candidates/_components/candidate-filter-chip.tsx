"use client";

import { useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Shared filter chip; multiple selections stay open until dismissed. */
export function CandidateFilterChip({
  label,
  multiple,
  value,
  options,
  onChange,
}: { label: string; options: { value: string; label: string }[] } & (
  { multiple: true; value: string[]; onChange: (value: string[]) => void } |
  { multiple?: false; value: string; onChange: (value: string) => void }
)) {
  const [open, setOpen] = useState(false);
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const active = selected.length > 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative inline-flex">
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-8 max-w-[260px] rounded-full pl-3 pr-8 font-normal text-sm",
              active
                ? "bg-brand/10 border-brand/20 text-brand hover:bg-brand/15 hover:text-brand"
                : "bg-muted/60 border-transparent text-muted-foreground hover:bg-muted",
            )}
          >
            <span className="truncate">
              {active ? options.filter((o) => selected.includes(o.value)).map((o) => o.label).join(", ") : label}
            </span>
            {!active ? (
              <ChevronDown className="ml-1 size-3.5 shrink-0 opacity-70" />
            ) : null}
          </Button>
        </PopoverTrigger>
        {active ? (
          <button
            type="button"
            aria-label={`Сбросить ${label.toLocaleLowerCase("ru")}`}
            onClick={(e) => {
              e.stopPropagation();
              if (multiple) onChange([]); else onChange("");
            }}
            className="absolute right-1.5 top-1/2 inline-flex size-4 -translate-y-1/2 items-center justify-center rounded-full bg-brand text-brand-foreground hover:bg-brand/90"
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>
      <PopoverContent
        align="start"
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (event.target instanceof HTMLElement)
            event.target.focus({ preventScroll: true });
        }}
        className="w-64 max-w-[calc(100vw-24px)] p-1"
      >
        <div
          className="max-h-72 overflow-y-auto"
          aria-label={`Варианты: ${label}`}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role={multiple ? "checkbox" : undefined}
              aria-checked={multiple ? (o.value ? selected.includes(o.value) : !active) : undefined}
              aria-pressed={multiple ? undefined : o.value === value}
              onClick={() => {
                if (multiple) onChange(!o.value ? [] : selected.includes(o.value) ? selected.filter((v) => v !== o.value) : [...selected, o.value]);
                else { onChange(o.value); setOpen(false); }
              }}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-sm px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent",
                (o.value ? selected.includes(o.value) : !active) && "bg-accent",
              )}
            >
              {o.label}
              {multiple && (o.value ? selected.includes(o.value) : !active) && <Check className="size-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
