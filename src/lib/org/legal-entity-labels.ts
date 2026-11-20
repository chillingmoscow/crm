import type { LegalForm, TaxSystem } from "@/types/database";

/** Подписи юрлица для интерфейса: одно место на список, карточку и архив. */

export const LEGAL_FORM_LABELS: Record<LegalForm, string> = {
  IP: "ИП",
  OOO: "ООО",
  AO: "АО",
  PAO: "ПАО",
  NKO: "НКО",
  OTHER: "Иное",
};

export const LEGAL_FORM_OPTIONS: { value: LegalForm; label: string }[] = [
  { value: "IP", label: "ИП" },
  { value: "OOO", label: "ООО" },
  { value: "AO", label: "АО (непубличное)" },
  { value: "PAO", label: "ПАО" },
  { value: "NKO", label: "НКО" },
  { value: "OTHER", label: "Иное" },
];

export const TAX_SYSTEM_LABELS: Record<TaxSystem, string> = {
  OSN: "Общая система (ОСН)",
  USN_INCOME: "УСН «Доходы»",
  USN_INCOME_EXPENSE: "УСН «Доходы минус расходы»",
  PSN: "Патент (ПСН)",
  NPD: "Самозанятый (НПД)",
  AUSN: "АУСН",
};

/** Короткая подпись для столбца таблицы. */
export const TAX_SYSTEM_SHORT: Record<TaxSystem, string> = {
  OSN: "ОСН",
  USN_INCOME: "УСН «Доходы»",
  USN_INCOME_EXPENSE: "УСН «Д−Р»",
  PSN: "Патент",
  NPD: "НПД",
  AUSN: "АУСН",
};

export function legalFormLabel(form: string): string {
  return LEGAL_FORM_LABELS[form as LegalForm] ?? form;
}
