"use client";

import { Combobox, type ComboboxOption } from "./combobox";
import {
  DEFAULT_AMOUNT_ROUNDING_SCALE,
  formatMoney,
  type AmountRoundingScale,
} from "@/lib/format/amount";

type BankAccountOption = {
  id: string;
  name: string;
  legal_entity_id: string;
  /** Display-only — current balance. */
  balance?: number | null;
  /** Display-only — bank name shown as hint. */
  bank_name?: string | null;
};

type Props = {
  bankAccounts: BankAccountOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  /**
   * Optional restriction to a single legal entity. Useful in transaction
   * forms where the bank account must belong to the chosen LE.
   */
  legalEntityId?: string | null;
  /** Optional id to exclude from the list (e.g. avoid self-transfer). */
  excludeId?: string | null;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  amountRoundingScale?: AmountRoundingScale;
};

export function BankAccountPicker({
  bankAccounts,
  value,
  onChange,
  legalEntityId,
  excludeId,
  placeholder = "Выберите счёт",
  allowClear = false,
  disabled,
  className,
  ariaLabel,
  amountRoundingScale = DEFAULT_AMOUNT_ROUNDING_SCALE,
}: Props) {
  const filtered = bankAccounts
    .filter((a) => (legalEntityId ? a.legal_entity_id === legalEntityId : true))
    .filter((a) => (excludeId ? a.id !== excludeId : true));

  const options: ComboboxOption[] = filtered.map((a) => ({
    value: a.id,
    label: a.name,
    hint:
      a.bank_name && a.balance !== null && a.balance !== undefined
        ? `${a.bank_name} • ${formatRub(a.balance, amountRoundingScale)}`
        : a.bank_name ??
          (a.balance !== null && a.balance !== undefined
            ? formatRub(a.balance, amountRoundingScale)
            : undefined),
    keywords: [a.bank_name ?? ""].filter(Boolean) as string[],
  }));

  return (
    <Combobox
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder="Поиск по названию или банку"
      emptyText="Счёт не найден"
      allowClear={allowClear}
      clearLabel="Все счета"
      disabled={disabled}
      className={className}
      ariaLabel={ariaLabel ?? "Банковский счёт"}
    />
  );
}

function formatRub(value: number, scale: AmountRoundingScale): string {
  return formatMoney(value, "RUB", scale);
}
