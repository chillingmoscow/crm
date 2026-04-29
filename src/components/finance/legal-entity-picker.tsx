"use client";

import { Combobox, type ComboboxOption } from "./combobox";

type LegalEntityOption = {
  id: string;
  name: string;
  short_name?: string | null;
  inn?: string | null;
};

type Props = {
  legalEntities: LegalEntityOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  /**
   * When true, an "Все юрлица" item appears at the top and selects null.
   * Off by default — pickers in forms require a selection.
   */
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

export function LegalEntityPicker({
  legalEntities,
  value,
  onChange,
  placeholder = "Выберите юрлицо",
  allowClear = false,
  disabled,
  className,
  ariaLabel,
}: Props) {
  const options: ComboboxOption[] = legalEntities.map((le) => ({
    value: le.id,
    label: le.short_name ?? le.name,
    hint: le.inn ? `ИНН ${le.inn}` : undefined,
    keywords: [le.name, le.inn ?? ""].filter(Boolean) as string[],
  }));

  return (
    <Combobox
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder="Поиск по названию или ИНН"
      emptyText="Юрлицо не найдено"
      allowClear={allowClear}
      clearLabel="Все юрлица"
      disabled={disabled}
      className={className}
      ariaLabel={ariaLabel ?? "Юрлицо"}
    />
  );
}
