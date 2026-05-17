"use client";

import { useMemo, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { KbProperty, KbPropertyColor } from "@/types/knowledge";

import { OptionChip } from "../option-chip";

/** Multi-select value-control: chips inline (выбранные значения) +
 *  trigger для открытия dropdown'а с checkbox-списком. Полностью
 *  параллелен SelectControl, но value — string[] вместо string|null.
 *  Cleanup options/optionColors происходит выше в onChangeOptions. */
export function MultiSelectControl({
  property,
  canEdit,
  onChangeValue,
}: {
  property: Extract<KbProperty, { type: "multi-select" }>;
  canEdit: boolean;
  // Принимаются call-site'ом, но не используются: редактирование опций
  // перенесено в OptionEditorPopover. Оставлены в типе для совместимости
  // с PropertyValueControl call-site (structural typing).
  canEditOptions?: boolean;
  onChangeValue: (value: string[]) => void;
  onChangeOptions?: (options: string[]) => void;
  onChangeOptionColors?: (
    optionColors: Partial<Record<string, KbPropertyColor>> | undefined,
  ) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const selectedSet = useMemo(() => new Set(property.value), [property.value]);

  const toggleValue = (option: string) => {
    if (selectedSet.has(option)) {
      onChangeValue(property.value.filter((v) => v !== option));
    } else {
      onChangeValue([...property.value, option]);
    }
  };

  if (!canEdit) {
    return property.value.length > 0 ? (
      <div className="flex flex-wrap gap-1">
        {property.value.map((v) => (
          <OptionChip
            key={v}
            value={v}
            explicit={property.optionColors?.[v]}
          />
        ))}
      </div>
    ) : (
      <span className="text-[13px] text-muted-foreground/50">—</span>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="min-h-7 min-w-[100px] max-w-full inline-flex items-center gap-1 flex-wrap
                       text-[13px] border border-transparent rounded px-1
                       hover:border-input data-[state=open]:border-input transition-colors
                       text-left"
          >
            {property.value.length > 0 ? (
              property.value.map((v) => (
                <OptionChip
                  key={v}
                  value={v}
                  explicit={property.optionColors?.[v]}
                />
              ))
            ) : (
              <span className="text-muted-foreground/50">—</span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={4}
          className="w-[260px] p-0 rounded-md"
        >
          <ul className="flex flex-col py-1 max-h-[260px] overflow-y-auto">
            {property.options.map((o) => {
              const checked = selectedSet.has(o);
              return (
                <li key={o}>
                  <button
                    type="button"
                    onClick={() => toggleValue(o)}
                    className="w-full flex items-center gap-2 px-2 py-1 hover:bg-accent text-left"
                  >
                    <Checkbox
                      checked={checked}
                      tabIndex={-1}
                      className="pointer-events-none"
                    />
                    <OptionChip
                      value={o}
                      explicit={property.optionColors?.[o]}
                      className="flex-1 min-w-0"
                    />
                  </button>
                </li>
              );
            })}
            {property.options.length === 0 && (
              <li className="px-2 py-2 text-[12px] text-muted-foreground">
                Опций пока нет
              </li>
            )}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
