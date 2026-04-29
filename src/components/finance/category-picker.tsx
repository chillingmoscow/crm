"use client";

import { Combobox, type ComboboxOption } from "./combobox";

type CategoryOption = {
  id: string;
  name: string;
  type: "income" | "expense";
};

type Props = {
  categories: CategoryOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  /**
   * Optional filter by category type. In transaction forms, income
   * transactions only allow `income` categories and vice versa.
   */
  type?: "income" | "expense";
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

export function CategoryPicker({
  categories,
  value,
  onChange,
  type,
  placeholder = "Выберите статью",
  allowClear = true,
  disabled,
  className,
  ariaLabel,
}: Props) {
  const filtered = type ? categories.filter((c) => c.type === type) : categories;

  const options: ComboboxOption[] = filtered.map((c) => ({
    value: c.id,
    label: c.name,
    hint: type ? undefined : c.type === "income" ? "Доход" : "Расход",
  }));

  return (
    <Combobox
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder="Поиск статьи"
      emptyText="Статья не найдена"
      allowClear={allowClear}
      clearLabel="Без статьи"
      disabled={disabled}
      className={className}
      ariaLabel={ariaLabel ?? "Статья"}
    />
  );
}
