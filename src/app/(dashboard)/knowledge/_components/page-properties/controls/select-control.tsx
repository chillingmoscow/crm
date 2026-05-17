"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import type { KbProperty, KbPropertyColor } from "@/types/knowledge";

import { OptionChip } from "../option-chip";

export function SelectControl({
  property,
  canEdit,
  onChangeValue,
}: {
  property: Extract<KbProperty, { type: "select" }>;
  canEdit: boolean;
  canEditOptions?: boolean;
  onChangeValue: (value: string | null) => void;
  onChangeOptions?: (options: string[]) => void;
  onChangeOptionColors?: (
    optionColors: Partial<Record<string, KbPropertyColor>> | undefined,
  ) => void;
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
    <div className="flex items-center gap-1.5 flex-wrap">
      <Select
        value={property.value ?? ""}
        onValueChange={(v) => onChangeValue(v === "__none__" ? null : v)}
      >
        <SelectTrigger
          className="h-7 w-auto min-w-[100px] max-w-[280px] text-[13px] border-transparent bg-transparent px-1
                     hover:border-input focus:border-input
                     [&>svg]:opacity-50 hover:[&>svg]:opacity-100"
        >
          {property.value ? (
            <OptionChip
              value={property.value}
              explicit={property.optionColors?.[property.value]}
            />
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </SelectTrigger>
        <SelectContent className="max-w-[320px]">
          <SelectItem value="__none__" className="text-muted-foreground">
            (не задано)
          </SelectItem>
          {property.options.map((o) => (
            <SelectItem key={o} value={o} className="py-1.5">
              <OptionChip
                value={o}
                explicit={property.optionColors?.[o]}
              />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
