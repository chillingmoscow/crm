/**
 * Готов ли склад к расчёту недостачи — одно значение на строку справочника
 * складов (/org/stores).
 *
 * Расчёт месяца (src/lib/stock/monthly-snapshot.ts) не подставляет значения по
 * умолчанию: акт склада без заведения и склад без решения о подразделении
 * делают месяц неполным. Раньше в списке это было видно только по жёлтой
 * отметке «Подразделение не задано», а склад без заведения выглядел
 * нормальным. Статус собирает оба условия в одном месте, в порядке, в котором
 * их чинят: сначала заведение (подразделение выбирается из его подразделений),
 * потом подразделение.
 *
 * Без импортов из `@/...`, чтобы node:test мог импортировать файл напрямую.
 */

export type StoreSetupStatus =
  | "no_venue"
  | "no_department"
  | "archived_department"
  | "ready";

export function storeSetupStatus(input: {
  venueId: string | null;
  scope: "unset" | "shared" | "department";
  departmentId: string | null;
  /** Привязанное подразделение в архиве. Неизвестное подразделение — не архивное. */
  departmentArchived: boolean;
}): StoreSetupStatus {
  if (!input.venueId) return "no_venue";
  if (input.scope === "department" && input.departmentId && input.departmentArchived) {
    return "archived_department";
  }
  if (input.scope === "unset" || (input.scope === "department" && !input.departmentId)) {
    return "no_department";
  }
  return "ready";
}

export const STORE_SETUP_STATUS_LABEL: Record<StoreSetupStatus, string> = {
  no_venue: "Нет заведения",
  no_department: "Нет подразделения",
  archived_department: "Подразделение в архиве",
  ready: "Настроен",
};

/** Пояснение в подсказке бейджа: что будет с недостачей и что сделать. */
export const STORE_SETUP_STATUS_HINT: Record<StoreSetupStatus, string> = {
  no_venue: "Акты склада не попадут в расчёт недостачи заведения. Выберите заведение",
  no_department: "Расчёт недостачи по складу будет неполным. Выберите подразделение или «Общий склад»",
  archived_department: "Архивное подразделение никому не засчитывается. Выберите другое",
  ready: "Заведение и плательщик недостачи выбраны",
};

/** Порядок при сортировке: сначала то, что требует внимания. */
export const STORE_SETUP_STATUS_RANK: Record<StoreSetupStatus, number> = {
  no_venue: 0,
  no_department: 1,
  archived_department: 2,
  ready: 3,
};
