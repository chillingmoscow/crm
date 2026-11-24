import type { BankAccountType } from "@/types/database";

/**
 * Подписи типов счёта — одни на список, карточку, фильтр и форму. Раньше в
 * списке было «Карта» и «Фонд», а в карточке «Дебетовая карта» и «Денежный
 * фонд»: один предмет назывался по-разному.
 */
export const BANK_ACCOUNT_TYPE_LABELS: Record<BankAccountType, string> = {
  cash: "Касса",
  checking: "Расчётный счёт",
  debit_card: "Карта",
  fund: "Фонд",
  safe: "Сейф",
};

/** Порядок в выборе: сначала то, что заводят чаще. */
export const BANK_ACCOUNT_TYPE_ORDER: BankAccountType[] = [
  "cash",
  "checking",
  "debit_card",
  "safe",
  "fund",
];

export const BANK_ACCOUNT_TYPE_OPTIONS = BANK_ACCOUNT_TYPE_ORDER.map((value) => ({
  value,
  label: BANK_ACCOUNT_TYPE_LABELS[value],
}));

/** Реквизиты банка есть у расчётного счёта и карты. */
export const hasBankDetails = (type: BankAccountType) =>
  type === "checking" || type === "debit_card";

/**
 * Вторая строка под названием счёта: банк и последние цифры карты.
 * Пустая строка, если показывать нечего.
 */
export function bankAccountSubtitle(row: {
  type: BankAccountType;
  bank_name: string | null;
  card_number_last4: string | null;
}): string {
  const parts: string[] = [];
  if (hasBankDetails(row.type) && row.bank_name?.trim()) parts.push(row.bank_name.trim());
  if (row.type === "debit_card" && row.card_number_last4?.trim())
    parts.push(`•••• ${row.card_number_last4.trim()}`);
  return parts.join(" · ");
}

/**
 * Баланс счёта строкой: минус типографский (U+2212), как требует DS;
 * `formatMoney` сам ставит дефис от Intl. Точность — настройка аккаунта.
 */
export function formatBalance(
  value: number,
  currency: string,
  format: (abs: number, currency: string) => string,
): string {
  return value < 0 ? `−${format(Math.abs(value), currency)}` : format(value, currency);
}
