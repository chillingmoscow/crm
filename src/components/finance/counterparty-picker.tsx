"use client";

import { Combobox, type ComboboxOption } from "./combobox";

type CounterpartyOption = {
  id: string;
  name: string;
  inn?: string | null;
};

type Props = {
  counterparties: CounterpartyOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

export function CounterpartyPicker({
  counterparties,
  value,
  onChange,
  placeholder = "Выберите контрагента",
  allowClear = true,
  disabled,
  className,
  ariaLabel,
}: Props) {
  const options: ComboboxOption[] = counterparties.map((cp) => ({
    value: cp.id,
    label: cp.name,
    hint: cp.inn ? `ИНН ${cp.inn}` : undefined,
    keywords: [cp.inn ?? ""].filter(Boolean) as string[],
  }));

  return (
    <Combobox
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder="Поиск по названию или ИНН"
      emptyText="Контрагент не найден"
      allowClear={allowClear}
      clearLabel="Без контрагента"
      disabled={disabled}
      className={className}
      ariaLabel={ariaLabel ?? "Контрагент"}
    />
  );
}
