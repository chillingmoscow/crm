/** Display labels only; stored audit codes and original values stay unchanged. */
const FIELD_VALUES: Record<string, Record<string, string>> = {
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
  return values ? values[value] ?? "Неизвестное значение" : null;
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
