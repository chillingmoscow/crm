// Чистые помощники таблицы актов инвентаризации (без React/JSX) — вынесены из
// documents-table.tsx, чтобы переиспользовать в main-компоненте и в саб-частях
// (documents-table-rows.tsx) и покрыть тестами.

import type { DocumentListRow, DocumentSortMode } from "@/lib/inventory/list-documents-shared";

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

// canViewResults обязателен: пользователи с inventory.fill_assigned_documents,
// но без inventory.view_results, не могут открыть /results — их редиректнёт
// прочь. Поэтому для них всегда возвращаем форму, даже у проведённых актов.
// Codex review #396 P1.
export function getDocHref(
  doc: Pick<DocumentListRow, "id" | "processed" | "results_has_line_amounts" | "status">,
  canViewResults: boolean,
) {
  const isResultsState =
    doc.processed || doc.results_has_line_amounts || doc.status === "results_blocked";
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
