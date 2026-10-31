"use client";
import { useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "@/components/ui/command";
export function MultiOptionPicker({
  id,
  label,
  options,
  selectedIds,
  onChange,
  disabled = false,
  placeholder = "Выберите значения",
  searchPlaceholder = "Найти",
}: {
  id?: string;
  label: string;
  options: { id: string; label: string; disabled?: boolean }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null),
    [open, setOpen] = useState(false);
  const selected = options
    .filter((o) => selectedIds.includes(o.id))
    .map((o) => o.label)
    .join(", ");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          ref={trigger}
          type="button"
          variant="outline"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          disabled={disabled}
          className="h-10 w-full min-w-0 justify-between gap-2 px-3 text-left text-sm font-normal"
        >
          <span className="truncate" title={selected}>
            {selected || placeholder}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        portalContainer={trigger.current?.closest<HTMLElement>(
          '[role="dialog"]',
        )}
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-32px)] p-0"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-[min(320px,50dvh)] overscroll-contain touch-pan-y">
            <CommandEmpty>Ничего не найдено</CommandEmpty>
            {options.map((o) => (
              <CommandItem
                key={o.id}
                value={`${o.label} ${o.id}`}
                disabled={o.disabled}
                onSelect={() =>
                  onChange(
                    selectedIds.includes(o.id)
                      ? selectedIds.filter((id) => id !== o.id)
                      : [...selectedIds, o.id],
                  )
                }
                className="gap-2 px-3 py-2.5"
              >
                <span>{o.label}</span>
                {selectedIds.includes(o.id) && (
                  <Check className="ml-auto size-4 text-brand" />
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
