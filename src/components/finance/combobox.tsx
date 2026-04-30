"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ComboboxOption = {
  value: string;
  label: string;
  /** Optional secondary text rendered below the label (e.g. INN, balance). */
  hint?: string;
  /** Optional keywords folded into the search index (e.g. INN digits). */
  keywords?: string[];
  /** When true, the option renders disabled and isn't selectable. */
  disabled?: boolean;
};

type Props = {
  options: ComboboxOption[];
  /** Currently selected value, or null. */
  value: string | null;
  onChange: (value: string | null) => void;

  /** Placeholder when nothing is selected. */
  placeholder?: string;
  /** Search input placeholder. */
  searchPlaceholder?: string;
  /** Empty-state copy when filter has no matches. */
  emptyText?: string;

  /**
   * When true, renders an extra "all" sentinel row at the top that maps
   * to `value: null` — used by switchers/filters where "no selection"
   * means "all entities".
   */
  allowClear?: boolean;
  clearLabel?: string;

  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  /** Optional label text to render inside the trigger when value is selected. */
  ariaLabel?: string;
};

/**
 * Searchable single-select combobox: shadcn Popover + cmdk Command.
 * Used by every finance picker (legal-entity / bank-account / category /
 * counterparty) and by the LegalEntitySwitcher.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Не выбрано",
  searchPlaceholder = "Поиск…",
  emptyText = "Ничего не найдено",
  allowClear = false,
  clearLabel = "Все",
  disabled,
  className,
  triggerClassName,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
            triggerClassName
          )}
        >
          <span className="truncate text-left flex-1">
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("p-0 w-[--radix-popover-trigger-width]", className)} align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {allowClear && (
                <CommandItem
                  // cmdk filters by value+keywords. Without the clearLabel
                  // in keywords, the clear row would vanish as soon as
                  // the user starts typing — wrong for a row that means
                  // "show everything".
                  value="__clear__"
                  keywords={[clearLabel, "все", "all", "сброс"]}
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value === null ? "opacity-100" : "opacity-0")}
                  />
                  <span className="text-muted-foreground italic">{clearLabel}</span>
                </CommandItem>
              )}
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  // cmdk filters by `value` only; folding label and any
                  // keywords into the searchable string lets the user
                  // type the human name and find the row.
                  keywords={[option.label, ...(option.keywords ?? [])]}
                  disabled={option.disabled}
                  onSelect={() => {
                    if (option.disabled) return;
                    if (option.value === value) {
                      // Re-selecting the current option clears only when
                      // allowClear is on. Required fields (allowClear=false)
                      // mustn't be droppable to null via this path.
                      if (allowClear) onChange(null);
                      setOpen(false);
                      return;
                    }
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0",
                      option.value === value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{option.label}</div>
                    {option.hint && (
                      <div className="text-xs text-muted-foreground truncate">
                        {option.hint}
                      </div>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
