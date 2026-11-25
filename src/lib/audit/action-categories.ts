/** Кросс-модульные категории действий журнала. Классификация по
 *  суффиксу `action_code` (`<entity>.<verb>`) — без реестра сотен
 *  кодов: конвенция именования даёт тип действия из последнего
 *  сегмента. Используется фильтром «Действие» в общем журнале
 *  (`/org/audit`) и во вкладках «Журнал» / «Активность» карточек —
 *  один набор категорий для всех разделов. */

export type AuditActionCategory =
  | "created"
  | "staffing"
  | "changed"
  | "deleted"
  | "restored"
  | "moved";

export const AUDIT_ACTION_CATEGORIES: {
  id: AuditActionCategory;
  name: string;
}[] = [
  { id: "created", name: "Создание" },
  { id: "staffing", name: "Приём и увольнение" },
  { id: "changed", name: "Изменение" },
  { id: "deleted", name: "Удаление" },
  { id: "restored", name: "Восстановление" },
  { id: "moved", name: "Перемещение" },
];

/** Суффиксы action_code на категорию. Любой не перечисленный суффикс
 *  под фильтр не попадает (фильтр аддитивный — выбрал «Создание»,
 *  видишь только *.created). «Прочее»-категории намеренно нет:
 *  чистый фильтр по понятным типам действий. */
const CATEGORY_SUFFIXES: Record<AuditActionCategory, string[]> = {
  // `_imported`, `_requested`: `stock.writeoffs.archive_imported`,
  // `stock.writeoffs.refresh_requested` (в LIKE `_` ловит и точку).
  // `.issued` — выдача зарплаты по плану выплат (`payroll.payout_plan.issued`).
  created: [".created", ".sent", "_imported", "_requested", ".issued"],
  // Приём в команду (сотрудник, кандидат) и увольнение с закрытием доступов.
  // `.ended` — официальное увольнение (`payroll.official_employment.ended`).
  staffing: [".hired", ".fired", ".access_removed", ".ended"],
  changed: [
    ".edited",
    ".renamed",
    ".updated",
    ".profile_updated",
    ".required_reading_toggled",
    ".locked",
    ".unlocked",
    ".role_changed",
    ".permissions_changed",
    ".toggled",
    ".changed",
    ".commented",
    ".photo_added",
    // `role.department_changed`, `department.head_changed`,
    // `staff.account_details_updated`: суффикс после подчёркивания.
    // В LIKE `_` — любой один символ, поэтому шаблон ловит и `.changed`.
    "_changed",
    "_updated",
    // `stock.writeoffs.pool_assigned`, `…pool_bulk_assigned` и `.assigned`.
    "_assigned",
    // Обновление из внешней системы: `stock.writeoffs.synced`, `cash.*.synced`.
    ".synced",
    ".reviewed",
    ".resolved",
    ".unresolved",
    ".expense_linked",
    ".supplier_added",
    ".supplier_removed",
    // Расписание: публикация, решения по чек-листам, заменам и отчётам.
    ".published",
    ".applied",
    ".approved",
    ".returned",
    ".rejected",
    ".answered",
    // Повторяющиеся платежи: пауза шаблона и разбор ожидаемого платежа.
    ".paused",
    ".resumed",
    ".posted",
    ".skipped",
    ".postponed",
    // План выплат: пересчёт черновика.
    ".recalculated",
  ],
  deleted: [".deleted", ".archived", ".cancelled"],
  restored: [".restored"],
  moved: [".moved"],
};

/** Категории → список like-паттернов для PostgREST (`*` = `%`).
 *  Невалидные id игнорируются. Пустой результат = фильтр не
 *  применять. */
export function categoriesToLikePatterns(
  categories: string[],
): string[] {
  const out: string[] = [];
  for (const c of categories) {
    const suffixes = CATEGORY_SUFFIXES[c as AuditActionCategory];
    if (suffixes) for (const s of suffixes) out.push(`*${s}`);
  }
  return out;
}
