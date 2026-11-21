"use client";

import { useState } from "react";

import { OptionSelect } from "@/components/ui/option-select";
import { TIMEZONE_OPTIONS } from "@/lib/org/venue-labels";

/**
 * Часовой пояс аккаунта для серверной формы общих настроек. Значение уходит
 * в FormData через `name`. Список поясов — тот же, что у заведения.
 */
export function TimezoneSelect({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const options = TIMEZONE_OPTIONS.some((o) => o.value === defaultValue)
    ? TIMEZONE_OPTIONS
    : [...TIMEZONE_OPTIONS, { value: defaultValue, label: defaultValue }];
  return (
    <OptionSelect
      id="timezone"
      name="timezone"
      value={value}
      onValueChange={setValue}
      options={options}
      className="mt-3 w-full"
    />
  );
}
