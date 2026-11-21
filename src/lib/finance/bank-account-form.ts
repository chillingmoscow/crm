import type { BankAccountFormInput } from "@/types/finance";
import type { BankAccountType } from "@/types/database";

// Без импорта bank-account-labels: модуль проверяется node:test без алиасов «@/».
const hasBankDetails = (type: BankAccountType) => type === "checking" || type === "debit_card";

/** Строка счёта, из которой собирается форма карточки. */
type BankAccountSource = {
  type: BankAccountType;
  name: string;
  legal_entity_id: string;
  venue_id: string | null;
  group_id: string | null;
  currency: string;
  bank_name: string | null;
  bik: string | null;
  account_number: string | null;
  correspondent_account: string | null;
  acquiring_percentage: number | null;
  card_holder: string | null;
  card_number_last4: string | null;
  description: string | null;
};

/** Значения полей формы: всё строками, пустая строка — «не указано». */
export type BankAccountFormState = {
  type: BankAccountType;
  name: string;
  legal_entity_id: string;
  venue_id: string;
  group_id: string;
  currency: string;
  bank_name: string;
  bik: string;
  account_number: string;
  correspondent_account: string;
  acquiring_percentage: string;
  card_holder: string;
  card_number_last4: string;
  description: string;
};

export type BankAccountFormErrors = Partial<Record<keyof BankAccountFormState, string>>;

export function emptyBankAccountForm(defaults: Partial<BankAccountFormState> = {}): BankAccountFormState {
  return {
    type: "cash",
    name: "",
    legal_entity_id: "",
    venue_id: "",
    group_id: "",
    currency: "RUB",
    bank_name: "",
    bik: "",
    account_number: "",
    correspondent_account: "",
    acquiring_percentage: "",
    card_holder: "",
    card_number_last4: "",
    description: "",
    ...defaults,
  };
}

export function bankAccountFormFromRow(row: BankAccountSource): BankAccountFormState {
  return {
    type: row.type,
    name: row.name,
    legal_entity_id: row.legal_entity_id,
    venue_id: row.venue_id ?? "",
    group_id: row.group_id ?? "",
    currency: row.currency || "RUB",
    bank_name: row.bank_name ?? "",
    bik: row.bik ?? "",
    account_number: row.account_number ?? "",
    correspondent_account: row.correspondent_account ?? "",
    acquiring_percentage:
      row.acquiring_percentage == null ? "" : String(row.acquiring_percentage).replace(".", ","),
    card_holder: row.card_holder ?? "",
    card_number_last4: row.card_number_last4 ?? "",
    description: row.description ?? "",
  };
}

const digits = (value: string) => value.replace(/\D/g, "");
const percent = (value: string) => Number(value.trim().replace(",", "."));

/** Ошибки по полям. Пустой объект — можно сохранять. */
export function validateBankAccountForm(form: BankAccountFormState): BankAccountFormErrors {
  const errors: BankAccountFormErrors = {};
  if (!form.name.trim()) errors.name = "Укажите название";
  if (!form.legal_entity_id) errors.legal_entity_id = "Выберите юрлицо";
  if (form.type === "checking") {
    if (form.bik && digits(form.bik).length !== 9) errors.bik = "В БИК 9 цифр";
    if (form.account_number && digits(form.account_number).length !== 20)
      errors.account_number = "В номере счёта 20 цифр";
    if (form.correspondent_account && digits(form.correspondent_account).length !== 20)
      errors.correspondent_account = "В корреспондентском счёте 20 цифр";
    if (form.acquiring_percentage.trim()) {
      const value = percent(form.acquiring_percentage);
      if (!Number.isFinite(value) || value < 0 || value > 100)
        errors.acquiring_percentage = "От 0 до 100";
    }
  }
  if (form.type === "debit_card" && form.card_number_last4 && digits(form.card_number_last4).length !== 4)
    errors.card_number_last4 = "Четыре последние цифры карты";
  return errors;
}

/**
 * Данные для сервера. Поля, которых у вида счёта нет, уходят пустыми: смена
 * вида при создании не оставляет в записи чужих реквизитов.
 */
export function bankAccountPayload(form: BankAccountFormState): BankAccountFormInput {
  const text = (value: string) => value.trim() || null;
  const checking = form.type === "checking";
  const card = form.type === "debit_card";
  return {
    type: form.type,
    name: form.name.trim(),
    legal_entity_id: form.legal_entity_id,
    venue_id: form.venue_id || null,
    group_id: form.group_id || null,
    currency: form.currency || "RUB",
    description: text(form.description),
    bank_name: hasBankDetails(form.type) ? text(form.bank_name) : null,
    bik: checking ? text(digits(form.bik)) : null,
    account_number: checking ? text(digits(form.account_number)) : null,
    correspondent_account: checking ? text(digits(form.correspondent_account)) : null,
    acquiring_percentage:
      checking && form.acquiring_percentage.trim() ? percent(form.acquiring_percentage) : null,
    card_holder: card ? text(form.card_holder) : null,
    card_number_last4: card ? text(digits(form.card_number_last4)) : null,
  };
}

/** Изменилось ли что-то относительно исходных значений (пробелы по краям не в счёт). */
export function bankAccountFormDirty(a: BankAccountFormState, b: BankAccountFormState): boolean {
  return (Object.keys(a) as (keyof BankAccountFormState)[]).some(
    (key) => a[key].trim() !== b[key].trim(),
  );
}

