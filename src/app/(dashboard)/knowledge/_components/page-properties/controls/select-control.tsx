"use client";

import type { KbProperty, KbPropertyColor } from "@/types/knowledge";

import { OptionChip } from "../option-chip";
import { OptionValuePicker } from "./option-value-picker";

export function SelectControl({
  property,
  canEdit,
  onChangeValue,
  onChangeOptions,
  onChangeOptionColors,
  onChangeOptionDescriptions,
  onRenameOption,
  onRemoveOption,
}: {
  property: Extract<KbProperty, { type: "select" }>;
  canEdit: boolean;
  canEditOptions?: boolean;
  onChangeValue: (value: string | null) => void;
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
    return property.value ? (
      <OptionChip
        value={property.value}
        explicit={property.optionColors?.[property.value]}
      />
    ) : (
      <span className="text-[13px] text-muted-foreground/50">—</span>
    );
  }

  return (
    <OptionValuePicker
      multi={false}
      value={property.value ? [property.value] : []}
      options={property.options}
      optionColors={property.optionColors}
      optionDescriptions={property.optionDescriptions}
      optionSort={property.optionSort}
      onChange={(next) => onChangeValue(next[0] ?? null)}
      onChangeOptions={(opts) => onChangeOptions?.(opts)}
      onChangeOptionColors={onChangeOptionColors}
      onChangeOptionDescriptions={onChangeOptionDescriptions}
      onRenameOption={onRenameOption}
      onRemoveOption={onRemoveOption}
    />
  );
}
