import { VENUE_TYPES } from "../constants";

/** Display labels only; stored audit codes and original values stay unchanged. */
const FIELD_VALUES: Record<string, Record<string, string>> = {
  missing_fine_state: {unknown:"Не проверено",recorded:"Уже учтён",not_recorded:"Не учтён"},
  expiry_fine_state: {unknown:"Не проверено",recorded:"Уже учтён",not_recorded:"Не учтён"},
  medical_state: {unknown:"Не проверено",missing:"Не предоставлена",present:"Предоставлена"},
  reimbursement_state: {unknown:"Не проверено",recorded:"Уже выплачена",not_recorded:"Не выплачена"},
  gender: {male:"Мужской",female:"Женский"},
  medium: { bonus: "Бонусы", money: "Деньги", none: "Без начисления" },
  external_state: {
    review: "Ожидает проверки",
    pending: "Ожидает обработки",
    done: "Обработано",
    not_required: "Не требуется",
  },
  kind: {
    bonus: "Премия", deduction: "Штраф", warning: "Предупреждение",
    allowance: "Надбавка за месяц", salary: "Зарплата", advance: "Аванс", tips: "Чаевые",
  },
  type: {
    ...Object.fromEntries(VENUE_TYPES.map(({ value, label }) => [value, label])),
    club: "Клуб", other: "Другое",
    income: "Доход", expense: "Расход", transfer: "Перевод",
    checking: "Расчётный счёт", debit_card: "Карта", cash: "Касса", fund: "Фонд", safe: "Сейф",
  },
  legal_form: { IP: "ИП", OOO: "ООО", AO: "АО", PAO: "ПАО", NKO: "НКО", OTHER: "Иное" },
  tax_system: {
    OSN: "ОСН", USN_INCOME: "УСН · доходы", USN_INCOME_EXPENSE: "УСН · доходы минус расходы",
    PSN: "ПСН", NPD: "НПД", AUSN: "АвтоУСН",
  },
};

export function auditFieldValueLabel(field: string, value: string): string | null {
  const values = FIELD_VALUES[field];
  return values?.[value] ?? null;
}

export function formatAuditDate(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "—";
  // SQL dates are calendar days, not instants. Never shift them to the viewer's zone.
  const calendar = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (calendar) return `${calendar[3]}.${calendar[2]}.${calendar[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}

const ACTIONS: Record<string, string> = {
  created: "создал(а) запись", updated: "изменил(а) запись", changed: "изменил(а) запись",
  edited: "изменил(а) запись", renamed: "переименовал(а) запись",
  deleted: "удалил(а) запись", archived: "отправил(а) запись в архив",
  restored: "восстановил(а) запись", cancelled: "отменил(а) операцию",
  imported: "перенёс(ла) данные", moved: "переместил(а) запись",
  commented: "добавил(а) комментарий", resolved: "завершил(а) обсуждение",
};
const SECTIONS: Record<string, string> = {
  payroll: "Зарплата", sales: "Продажи", integration: "Интеграции",
  finance: "Финансы", inventory: "Инвентаризация", staff: "Сотрудники",
  role: "Должности", department: "Подразделения", venue: "Заведения",
  legal_entity: "Юрлица", account: "Аккаунт", invitation: "Приглашения",
  kb_page: "База знаний", kb_thread: "База знаний",
};

/** A new backend event must not expose its technical code in the journal. */
export function auditFallbackHeadline(code: string): string {
  const parts = code.split(".");
  const action = ACTIONS[parts.at(-1) ?? ""] ?? "выполнил(а) действие";
  const section = SECTIONS[parts[0]];
  return section ? `${action} в разделе «${section}»` : `${action} в системе`;
}

const FIELD_LABELS: Record<string, string> = {
  hired_on: "дата приёма",
  birthday: "дата рождения",
  gender: "пол",
  gift_role: "группа для подарков",
  medical_required: "медкнижка требуется",
  medical_state: "медкнижка",
  examined_on: "дата обследования",
  valid_until: "действует до",
  reimbursement_state: "прежняя компенсация",
  missing_fine_state:"прежний штраф за отсутствие медкнижки",
  expiry_fine_state:"прежний штраф за просрочку",
  legacy_reconciled: "прежние начисления сверены",
  medical_case_id: "обследование",
  // staff
  phone: "телефон",
  telegram_id: "телеграм",
  birth_date: "дата рождения",
  employment_date: "дата трудоустройства",
  medical_book_number: "номер медкнижки",
  medical_book_date: "срок действия медкнижки",
  passport_photos: "фото паспорта",
  comment: "комментарий HR",
  business_date: "дата начисления",
  reason: "основание",
  medium: "способ учёта",
  approved: "учтено в расчёте",
  delete_reason: "причина удаления",
  deleted_at: "дата удаления",
  external_state: "обработка бонусов",
  employee_id: "сотрудник",
  kind: "тип записи",
  // finance (общие)
  name: "название",
  type: "тип",
  amount: "сумма",
  currency: "валюта",
  description: "описание",
  date: "дата",
  group_id: "группа",
  is_active: "активность",
  // finance.transaction
  bank_account_id: "счёт",
  to_bank_account_id: "счёт получатель",
  to_legal_entity_id: "юрлицо получатель",
  category_id: "статья",
  counterparty_id: "контрагент",
  // bank_account
  bank_name: "банк",
  bik: "БИК",
  account_number: "номер счёта",
  card_holder: "держатель карты",
  card_number_last4: "последние 4 цифры карты",
  // counterparty
  legal_form: "правовая форма",
  inn: "ИНН",
  kpp: "КПП",
  ogrn: "ОГРН",
  contact_person: "контактное лицо",
  email: "email",
  address: "адрес",
  // category
  color: "цвет",
  icon: "иконка",
  // org / accounts / venues
  logo_url: "логотип",
  ai_enabled: "AI-ассистент",
  // venues
  timezone: "часовой пояс",
  default_legal_entity_id: "юрлицо по умолчанию",
  // legal_entities
  short_name: "сокращённое название",
  okpo: "ОКПО",
  okved: "ОКВЭД",
  tax_system: "налоговая система",
  vat_payer: "плательщик НДС",
  legal_address: "юридический адрес",
  actual_address: "фактический адрес",
  postal_address: "почтовый адрес",
  director_name: "ФИО директора",
  director_position: "должность подписанта",
  accountant_name: "ФИО бухгалтера",
  signature_basis: "основание подписи",
  website: "сайт",
  default_bank_name: "банк по умолчанию",
  default_bik: "БИК банка",
  default_account_number: "номер счёта",
  default_corr_account: "корр. счёт",
};

export function auditFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}
