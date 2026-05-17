/** Кросс-модульные категории действий журнала. Классификация по
 *  суффиксу `action_code` (`<entity>.<verb>`) — без реестра сотен
 *  кодов: конвенция именования даёт тип действия из последнего
 *  сегмента. Используется фильтром «Действие» в общем журнале
 *  (`/org/audit`) — один набор категорий для всех разделов. */

export type AuditActionCategory =
  | "created"
  | "changed"
  | "deleted"
  | "restored"
  | "moved";

export const AUDIT_ACTION_CATEGORIES: {
  id: AuditActionCategory;
  name: string;
}[] = [
  { id: "created", name: "Создание" },
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
  created: [".created"],
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
  ],
  deleted: [".deleted", ".archived"],
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
