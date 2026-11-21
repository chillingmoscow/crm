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
import { fieldFocusClass, fieldInvalidClass } from "@/components/ui/field-styles";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type { ComboboxOption } from "./combobox";

type Props = {
  options: ComboboxOption[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
};

/** Выбор нескольких значений с поиском — та же оболочка, что у `Combobox`,
 *  но список не закрывается после выбора. В поле — «А, Б» или «А и ещё 3». */
export function MultiCombobox({
  options,
  values,
  onChange,
  placeholder = "Не выбрано",
  searchPlaceholder = "Поиск",
  emptyText = "Ничего не найдено",
  disabled,
  ariaLabel,
  id,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => {
    const byValue = new Map(options.map((o) => [o.value, o.label]));
    return values.map((value) => byValue.get(value)).filter((label): label is string => Boolean(label));
  }, [options, values]);

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length <= 2
        ? selected.join(", ")
        : `${selected[0]} и ещё ${selected.length - 1}`;

  const toggle = (value: string) => {
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "w-full min-w-0 justify-between font-normal",
            fieldFocusClass,
            fieldInvalidClass,
            selected.length === 0 && "text-muted-foreground",
          )}
        >
          <span className="flex-1 truncate text-left">{summary}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const checked = values.includes(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={[option.label, ...(option.keywords ?? [])]}
                    disabled={option.disabled}
                    onSelect={() => toggle(option.value)}
                  >
                    <Check className={cn("mr-2 h-4 w-4 shrink-0", checked ? "opacity-100" : "opacity-0")} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{option.label}</div>
                      {option.hint ? (
                        <div className="truncate text-xs text-muted-foreground">{option.hint}</div>
                      ) : null}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
