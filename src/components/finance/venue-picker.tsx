"use client";

import { Combobox, type ComboboxOption } from "./combobox";

type VenueOption = {
  id: string;
  name: string;
};

type Props = {
  venues: VenueOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  /**
   * When true, surfaces a "Без точки" item that selects null. Used for
   * bank accounts where venue_id is optional (account is shared across
   * the legal entity rather than tied to a single venue).
   */
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

export function VenuePicker({
  venues,
  value,
  onChange,
  placeholder = "Выберите точку",
  allowClear = false,
  disabled,
  className,
  ariaLabel,
}: Props) {
  const options: ComboboxOption[] = venues.map((v) => ({
    value: v.id,
    label: v.name,
  }));

  return (
    <Combobox
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder="Поиск точки"
      emptyText="Точка не найдена"
      allowClear={allowClear}
      clearLabel="Без точки"
      disabled={disabled}
      className={className}
      ariaLabel={ariaLabel ?? "Точка"}
    />
  );
}
