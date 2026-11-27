// Чистые помощники таблицы актов инвентаризации (без React/JSX) — вынесены из
// documents-table.tsx, чтобы переиспользовать в main-компоненте и в саб-частях
// (documents-table-rows.tsx) и покрыть тестами.

// Относительный путь, а не alias: файл покрыт node:test, а тест-раннер не
// резолвит пути из tsconfig (та же причина, что в list-documents-shared.ts).
import { hasCountedResults } from "../../../../../lib/inventory/act-status.ts";
import type { DocumentListRow, DocumentSortMode } from "@/lib/inventory/list-documents-shared";

export type VenueOption = { id: string; name: string };
export type StoreOption = { id: string; title: string };

export type SortField = "date" | "number" | "status";

export const SORT_FIELD_LABEL: Record<SortField, string> = {
  date: "Дата",
  number: "Номер",
  status: "Статус",
};

export const SORT_FIELDS: SortField[] = ["date", "number", "status"];

// Привязка между UI-полем сортировки и заголовком колонки таблицы.
export const COLUMN_TO_FIELD: Record<string, SortField> = {
  document_number: "number",
  invoice_date: "date",
  status: "status",
};

export function sortToField(mode: DocumentSortMode): SortField {
  if (mode === "date_desc" || mode === "date_asc") return "date";
  if (mode === "number_desc" || mode === "number_asc") return "number";
  return "status";
}

export function sortToDirection(mode: DocumentSortMode): "asc" | "desc" {
  return mode.endsWith("_asc") ? "asc" : "desc";
}

export function combineSort(field: SortField, direction: "asc" | "desc"): DocumentSortMode {
  if (field === "status") return direction === "asc" ? "status_asc" : "status_desc";
  if (field === "date") return direction === "asc" ? "date_asc" : "date_desc";
  return direction === "asc" ? "number_asc" : "number_desc";
}

// Сортировка в адресе — массив режимов (`date_desc,number_asc`), а общий
// каркас таблицы (`DataTable`, `TableConditions`, `TableSortPicker`) работает
// с TanStack `SortingState` по id столбцов. Два адаптера ниже переводят одно
// в другое без потерь; порядок элементов = приоритет ключей.
const FIELD_TO_COLUMN: Record<SortField, string> = {
  date: "invoice_date",
  number: "document_number",
  status: "status",
};

/** Столбцы, по которым список сортируется на сервере. */
export const SORTABLE_COLUMNS = SORT_FIELDS.map((field) => FIELD_TO_COLUMN[field]);

export function sortModesToSorting(modes: DocumentSortMode[]): { id: string; desc: boolean }[] {
  return modes.map((mode) => ({
    id: FIELD_TO_COLUMN[sortToField(mode)],
    desc: sortToDirection(mode) === "desc",
  }));
}

export function sortingToSortModes(sorting: { id: string; desc: boolean }[]): DocumentSortMode[] {
  const out: DocumentSortMode[] = [];
  for (const item of sorting) {
    const field = COLUMN_TO_FIELD[item.id];
    if (!field) continue;
    const mode = combineSort(field, item.desc ? "desc" : "asc");
    if (!out.some((existing) => sortToField(existing) === field)) out.push(mode);
  }
  return out;
}

// Три функции выше как один кодек для useMultiSort. Тип не аннотируем
// намеренно: файл покрыт node:test, а раннер не резолвит alias из
// tsconfig — импорт типа тут лишний, совместимость проверит вызов.
export const DOCUMENT_SORT_CODEC = {
  toField: sortToField,
  toDirection: sortToDirection,
  combine: combineSort,
};

// canViewResults обязателен: пользователи с inventory.fill_assigned_documents,
// но без inventory.view_results, не могут открыть /results — их редиректнёт
// прочь. Поэтому для них всегда возвращаем форму, даже у проведённых актов.
// Codex review #396 P1.
export function getDocHref(
  doc: Pick<DocumentListRow, "id" | "processed" | "results_has_line_amounts" | "status">,
  canViewResults: boolean,
) {
  // Итоги существуют только после сдачи акта: до этого «разница» из Quick Resto
  // равна минус складскому остатку, и вести туда бессмысленно (там заглушка).
  // results_has_line_amounts для этого не годится — QR выставляет его и на
  // нетронутом акте.
  const isResultsState = hasCountedResults(doc.status);
  if (isResultsState && canViewResults) {
    return `/documents/inventory/${doc.id}/results`;
  }
  return `/documents/inventory/${doc.id}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ru-RU");
  } catch {
    return iso;
  }
}

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Группировка по дате имеет смысл, только когда список и так идёт по дате:
 * при сортировке по номеру или статусу акты одной даты разбросаны по списку.
 * Пустая сортировка — это date_desc по умолчанию.
 */
export function groupsByDate(sort: readonly DocumentSortMode[]): boolean {
  return sort.length === 0 || sortToField(sort[0]) === "date";
}

type NetResultsRow = Pick<
  DocumentListRow,
  "results_has_line_amounts" | "status" | "totals_unavailable" | "surplus_sum" | "shortfall_sum"
>;

/**
 * Нетто-итог (излишки − недостачи) по набору актов: выделение, группа одной
 * даты. Акты без сданных итогов не считаются. Если хотя бы по одному акту итог
 * посчитать не удалось, `unavailable`: частичная сумма выглядела бы как полная.
 * `counted` — сколько актов вошло в сумму.
 */
export function netResultsTotal(rows: readonly NetResultsRow[]) {
  let net = 0;
  let counted = 0;
  let unavailable = false;
  for (const row of rows) {
    if (!row.results_has_line_amounts || !hasCountedResults(row.status)) continue;
    if (row.totals_unavailable) {
      unavailable = true;
      continue;
    }
    net += (row.surplus_sum ?? 0) - (row.shortfall_sum ?? 0);
    counted += 1;
  }
  return { net, counted, unavailable };
}
