"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ColumnOrderState,
  ColumnSizingState,
  RowSelectionState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";

export type TableStateColumn = {
  id: string;
  defaultVisible?: boolean;
  defaultSize?: number;
};

type PersistedTableState = {
  columnVisibility?: VisibilityState;
  columnOrder?: ColumnOrderState;
  columnSizing?: ColumnSizingState;
  pageSize?: number;
};

type UseTableStateInput = {
  tableId: string;
  columns: TableStateColumn[];
  defaultPageSize?: number;
};

export function useTableState({
  tableId,
  columns,
  defaultPageSize = 25,
}: UseTableStateInput) {
  const storageKey = `sheerly.table.${tableId}`;
  const defaultColumnOrder = useMemo(() => columns.map((column) => column.id), [columns]);
  const defaultVisibility = useMemo(
    () =>
      Object.fromEntries(
        columns.map((column) => [column.id, column.defaultVisible !== false]),
      ) as VisibilityState,
    [columns],
  );
  const defaultSizing = useMemo(
    () =>
      Object.fromEntries(
        columns
          .filter((column) => typeof column.defaultSize === "number")
          .map((column) => [column.id, column.defaultSize as number]),
      ) as ColumnSizingState,
    [columns],
  );

  const [persisted] = useState<PersistedTableState>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as PersistedTableState) : {};
    } catch {
      return {};
    }
  });
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => ({ ...defaultVisibility, ...persisted.columnVisibility }),
  );
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(
    () => normalizeColumnOrder(persisted.columnOrder, defaultColumnOrder),
  );
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(
    () => ({ ...defaultSizing, ...persisted.columnSizing }),
  );
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: persisted.pageSize ?? defaultPageSize,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const payload: PersistedTableState = {
      columnVisibility,
      columnOrder,
      columnSizing,
      pageSize: pagination.pageSize,
    };
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [columnOrder, columnSizing, columnVisibility, pagination.pageSize, storageKey]);

  const resetColumns = () => {
    setColumnVisibility(defaultVisibility);
    setColumnOrder(defaultColumnOrder);
    setColumnSizing(defaultSizing);
  };

  return {
    search,
    setSearch,
    searchOpen,
    setSearchOpen,
    sorting,
    setSorting,
    rowSelection,
    setRowSelection,
    columnVisibility,
    setColumnVisibility,
    columnOrder,
    setColumnOrder,
    columnSizing,
    setColumnSizing,
    pagination,
    setPagination,
    resetColumns,
  };
}

function normalizeColumnOrder(
  persisted: ColumnOrderState | undefined,
  defaults: ColumnOrderState,
) {
  if (!persisted || persisted.length === 0) return defaults;
  const allowed = new Set(defaults);
  const ordered = persisted.filter((id) => allowed.has(id));
  const missing = defaults.filter((id) => !ordered.includes(id));
  return [...ordered, ...missing];
}
