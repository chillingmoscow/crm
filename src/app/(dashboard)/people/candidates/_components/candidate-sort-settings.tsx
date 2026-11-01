"use client";
import type { SortingState } from "@tanstack/react-table";
import {
  TableSortPicker,
  TableSortSettings,
} from "@/components/shared/table/table-sort-settings";
import { CANDIDATE_SORT_FIELDS } from "@/lib/candidates/types";
import { FIELD_LABELS } from "./candidate-table";
type Props = { sorting: SortingState; onChange: (next: SortingState) => void };
export function CandidateSortPicker(props: Props) {
  return (
    <TableSortPicker
      {...props}
      fields={CANDIDATE_SORT_FIELDS}
      labels={FIELD_LABELS}
    />
  );
}
export function CandidateSortSettings(props: Props) {
  return (
    <TableSortSettings
      {...props}
      fields={CANDIDATE_SORT_FIELDS}
      labels={FIELD_LABELS}
    />
  );
}
