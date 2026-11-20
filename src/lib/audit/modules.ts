/** Разделы общего журнала (`/org/audit`) — модули приложения, как в
 *  боковом меню. Раздел определяется по префиксу `action_code`
 *  (`payroll.*`, `finance.*`, …), а не по `entity_type`: многие события
 *  модуля пишутся на заведение (`entity_type = 'venue'`, например сверка
 *  кассы или настройки продаж), и фильтр по типу объекта их терял бы
 *  или путал с «Заведениями».
 *
 *  Вкладки «Журнал» / «Активность» в карточках продолжают фильтровать
 *  по типу объекта (`AUDIT_SECTIONS`): там нужен срез конкретной
 *  карточки, а не модуля. */
export const AUDIT_MODULES: {
  id: string;
  name: string;
  /** Префиксы `action_code` вместе с точкой. */
  prefixes: string[];
}[] = [
  { id: "staff", name: "Сотрудники", prefixes: ["staff.", "invitation."] },
  { id: "candidates", name: "Кандидаты", prefixes: ["candidate."] },
  {
    id: "roles",
    name: "Должности и подразделения",
    prefixes: ["role.", "department."],
  },
  { id: "payroll", name: "Зарплата", prefixes: ["payroll."] },
  { id: "finance", name: "Финансы", prefixes: ["finance.", "cash."] },
  { id: "schedule", name: "Расписание", prefixes: ["schedule."] },
  { id: "sales", name: "Продажи", prefixes: ["sales."] },
  {
    id: "stock",
    name: "Номенклатура и склад",
    prefixes: ["catalog.", "store.", "inventory.", "stock."],
  },
  { id: "guests", name: "Гости", prefixes: ["crm."] },
  {
    id: "org",
    name: "Организация",
    prefixes: ["account.", "venue.", "legal_entity.", "integration."],
  },
  { id: "kb", name: "База знаний", prefixes: ["kb_page.", "kb_thread."] },
];

/** Разделы → like-шаблоны для PostgREST (`*` = `%`). Неизвестные id
 *  игнорируются; пустой результат = фильтр не применять. */
export function modulesToLikePatterns(ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const section = AUDIT_MODULES.find((m) => m.id === id);
    if (section) for (const prefix of section.prefixes) out.push(`${prefix}*`);
  }
  return out;
}

/** Раздел события по его коду — для подписи в строке и тестов. */
export function auditModuleOf(actionCode: string): string | null {
  return (
    AUDIT_MODULES.find((m) => m.prefixes.some((p) => actionCode.startsWith(p)))
      ?.id ?? null
  );
}
