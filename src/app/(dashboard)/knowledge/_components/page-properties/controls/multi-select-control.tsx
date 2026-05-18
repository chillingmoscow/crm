"use client";

import type { KbProperty, KbPropertyColor } from "@/types/knowledge";

import { OptionChip } from "../option-chip";
import { OptionValuePicker } from "./option-value-picker";

/** Multi-select value-control: чипы выбранного + поисковый пикер с
 *  созданием на лету. Параллелен SelectControl, value — string[]. */
export function MultiSelectControl({
  property,
  canEdit,
  canEditOptions = true,
  onChangeValue,
  onChangeOptions,
  onChangeOptionColors,
  onChangeOptionDescriptions,
  onRenameOption,
  onRemoveOption,
}: {
  property: Extract<KbProperty, { type: "multi-select" }>;
  canEdit: boolean;
  canEditOptions?: boolean;
  onChangeValue: (value: string[]) => void;
  onChangeOptions?: (options: string[]) => void;
  onChangeOptionColors?: (
    optionColors: Partial<Record<string, KbPropertyColor>> | undefined,
  ) => void;
  onChangeOptionDescriptions?: (
    d: Partial<Record<string, string>> | undefined,
  ) => void;
  onRenameOption?: (from: string, to: string) => void;
  onRemoveOption?: (option: string) => void;
}) {
  if (!canEdit) {
    return property.value.length > 0 ? (
      <div className="flex flex-wrap gap-1">
        {property.value.map((v) => (
          <OptionChip key={v} value={v} explicit={property.optionColors?.[v]} />
        ))}
      </div>
    ) : (
      <span className="text-[13px] text-muted-foreground/50">—</span>
    );
  }

  return (
    <OptionValuePicker
      multi
      canEditOptions={canEditOptions}
      value={property.value}
      options={property.options}
      optionColors={property.optionColors}
      optionDescriptions={property.optionDescriptions}
      optionSort={property.optionSort}
      onChange={(next) => onChangeValue(next)}
      onChangeOptions={(opts) => onChangeOptions?.(opts)}
      onChangeOptionColors={onChangeOptionColors}
      onChangeOptionDescriptions={onChangeOptionDescriptions}
      onRenameOption={onRenameOption}
      onRemoveOption={onRemoveOption}
    />
  );
}
