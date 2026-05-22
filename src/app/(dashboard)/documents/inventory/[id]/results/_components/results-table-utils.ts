// Чистые помощники таблицы итогов акта (без React/JSX) — вынесены из
// results-table.tsx для переиспользования в main-компоненте и тулбар-частях
// (results-table-controls.tsx) и для покрытия тестами.

export type ResultColumnKey =
  | "calculated"
  | "fact"
  | "difference"
  | "management"
  | "status"
  | "recount"
  | "comment";
export type ResultStatusFilter = "all" | "included" | "excluded" | "resort";
export type ResultRecountFilter = "all" | "flagged" | "clear";

export const RESULT_RECOUNT_LABEL: Record<ResultRecountFilter, string> = {
  all:     "Все",
  flagged: "На пересчёт",
  clear:   "Без пересчёта",
};

// Multi-sort 1-в-1 с эталоном documents-table.tsx / form-editor: поле +
// направление в combined-значении, sorts — массив (порядок = приоритет).
export type ResultSortField = "name" | "group" | "empty" | "sum";
export type ResultSortMode =
  | "name_asc"  | "name_desc"
  | "group_asc" | "group_desc"
  | "empty_first" | "empty_last"
  | "sum_asc" | "sum_desc";

export const RESULT_SORT_FIELDS: ResultSortField[] = ["name", "group", "empty", "sum"];

export const RESULT_SORT_FIELD_LABEL: Record<ResultSortField, string> = {
  name:  "Название",
  group: "Группа",
  empty: "Заполненность",
  sum:   "Сумма расхождения",
};

export const RESULT_STATUS_LABEL: Record<ResultStatusFilter, string> = {
  all:      "Все",
  included: "Учитывать",
  excluded: "Не учитывать",
  resort:   "Пересорт",
};

export function resultSortToField(mode: ResultSortMode): ResultSortField {
  if (mode === "name_asc"  || mode === "name_desc")  return "name";
  if (mode === "group_asc" || mode === "group_desc") return "group";
  if (mode === "empty_first" || mode === "empty_last") return "empty";
  return "sum";
}

export function resultSortToDirection(mode: ResultSortMode): "asc" | "desc" {
  if (mode === "empty_first") return "asc";
  if (mode === "empty_last")  return "desc";
  return mode.endsWith("_asc") ? "asc" : "desc";
}

export function combineResultSort(field: ResultSortField, direction: "asc" | "desc"): ResultSortMode {
  if (field === "name")  return direction === "asc" ? "name_asc"  : "name_desc";
  if (field === "group") return direction === "asc" ? "group_asc" : "group_desc";
  if (field === "empty") return direction === "asc" ? "empty_first" : "empty_last";
  return direction === "asc" ? "sum_asc" : "sum_desc";
}

// size — числовой default-размер для TanStack columnSizing (px). Не строки:
// раньше был `width: "minmax(180px,.7fr)"` → parseInt давал NaN → 120px и
// «Комментарий» схлопывался (Codex P2 #401).
export const RESULT_COLUMNS: Array<{ key: ResultColumnKey; label: string; size: number }> = [
  // Порядок: Расчёт (книжный остаток) → Факт → Разница — естественная
  // последовательность для проверки инвентаризации.
  { key: "calculated", label: "Расчёт", size: 120 },
  { key: "fact", label: "Факт", size: 120 },
  { key: "difference", label: "Разница", size: 120 },
  { key: "management", label: "Упр. сумма", size: 130 },
  { key: "status", label: "Статус", size: 140 },
  { key: "recount", label: "Пересчёт", size: 100 },
  { key: "comment", label: "Комментарий", size: 240 },
];

export const RESULTS_TABLE_ID = "documents.inventory.results";

// Какие колонки кликабельны для сортировки по шапке (как в documents-table).
// Группа сортируется только через pin (отдельной колонки нет).
export const COLUMN_TO_RESULT_FIELD: Record<string, ResultSortField> = {
  name:       "name",
  fact:       "empty",
  management: "sum",
};

// Минимум полей строки итогов для расчёта «есть расхождение / открытое».
type ResultDifferenceItem = {
  difference_amount: number | null;
  difference_sum: number | null;
  excluded_from_totals?: boolean | null;
};
type ResultRemainder = {
  remainingDifferenceAmount: number;
  remainingDifferenceSum: number;
};

export function hasDifference(item: ResultDifferenceItem) {
  const amount = Number(item.difference_amount ?? 0);
  const sum = Number(item.difference_sum ?? 0);
  return amount !== 0 || sum !== 0;
}

// Открытое (нерешённое) расхождение для счётчика «расхождений N»:
// исключённые из итогов и полностью покрытые активным пересортом (остаток 0)
// расхождениями не считаются — зеркало логики управленческих итогов.
export function isOpenDifference(
  item: ResultDifferenceItem,
  resortItem: ResultRemainder | undefined,
) {
  if (item.excluded_from_totals) return false;
  if (resortItem) {
    return (
      Number(resortItem.remainingDifferenceAmount ?? 0) !== 0 ||
      Number(resortItem.remainingDifferenceSum ?? 0) !== 0
    );
  }
  return hasDifference(item);
}

export function differenceClass(value: number | null | undefined) {
  const numericValue = Number(value ?? 0);
  if (numericValue < 0) return "text-red-700 dark:text-red-400";
  if (numericValue > 0) return "text-green-700 dark:text-green-400";
  return "text-muted-foreground";
}
