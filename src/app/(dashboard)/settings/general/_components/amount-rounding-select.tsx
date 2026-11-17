"use client";

import { useState } from "react";

import { OptionSelect } from "@/components/ui/option-select";
import { AMOUNT_ROUNDING_OPTIONS } from "@/lib/format/amount";

/**
 * Выбор округления сумм для серверной формы общих настроек. Значение уходит
 * в FormData через `name`, как раньше у нативного `<select>`.
 */
export function AmountRoundingSelect({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <OptionSelect
      id="amountRoundingScale"
      name="amountRoundingScale"
      value={value}
      onValueChange={setValue}
      options={AMOUNT_ROUNDING_OPTIONS.map((option) => ({
        value: String(option.value),
        label: `${option.label} · ${option.description}`,
      }))}
      className="mt-3 w-full"
    />
  );
}
