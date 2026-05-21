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
  /**
   * Сигнатура набора колонок (id'шники конфига). Если она изменилась —
   * значит колонку добавили/убрали/переименовали, и сохранённый
   * пользовательский порядок устарел: сбрасываем порядок к конфигу, чтобы
   * новые колонки встали на свои места (а не «прилипали» в хвост после
   * actions). Sizing/visibility ключатся по id и переживают смену набора.
   */
  columnsSignature?: string;
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
  // Сигнатура набора колонок — для инвалидации сохранённого порядка при
  // изменении набора (см. PersistedTableState.columnsSignature).
  const columnsSignature = useMemo(() => defaultColumnOrder.join("|"), [defaultColumnOrder]);
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

  const [isHydrated, setIsHydrated] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => defaultVisibility,
  );
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(
    () => defaultColumnOrder,
  );
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(
    () => defaultSizing,
  );
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: defaultPageSize,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      const persisted = raw ? (JSON.parse(raw) as PersistedTableState) : {};
      setColumnVisibility({ ...defaultVisibility, ...persisted.columnVisibility });
      // Если набор колонок изменился (нет сигнатуры или она другая) —
      // игнорируем сохранённый порядок и берём конфиг: новая колонка встаёт
      // на своё место, а не в хвост после actions.
      const orderIsCurrent = persisted.columnsSignature === columnsSignature;
      setColumnOrder(
        orderIsCurrent
          ? normalizeColumnOrder(persisted.columnOrder, defaultColumnOrder)
          : defaultColumnOrder,
      );
      setColumnSizing({ ...defaultSizing, ...persisted.columnSizing });
      setPagination((current) => ({
        pageIndex: current.pageIndex,
        pageSize: persisted.pageSize ?? defaultPageSize,
      }));
    } catch {
      setColumnVisibility(defaultVisibility);
      setColumnOrder(defaultColumnOrder);
      setColumnSizing(defaultSizing);
      setPagination((current) => ({ ...current, pageSize: defaultPageSize }));
    } finally {
      setIsHydrated(true);
    }
  }, [columnsSignature, defaultColumnOrder, defaultPageSize, defaultSizing, defaultVisibility, storageKey]);

  useEffect(() => {
    if (typeof window === "undefined" || !isHydrated) return;
    const payload: PersistedTableState = {
      columnVisibility,
      columnOrder,
      columnSizing,
      pageSize: pagination.pageSize,
      columnsSignature,
    };
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [columnOrder, columnSizing, columnVisibility, columnsSignature, isHydrated, pagination.pageSize, storageKey]);

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
  const orderedSet = new Set(ordered);
  const missing = defaults.filter((id) => !orderedSet.has(id));
  if (missing.length === 0) return ordered;
  // Вставляем недостающие (новые) колонки на их конфиг-позицию: перед первой
  // уже присутствующей колонкой, чей индекс в defaults больше — так новая
  // колонка не «прилипает» в хвост (например после actions).
  const result = [...ordered];
  for (const id of missing) {
    const defIndex = defaults.indexOf(id);
    let insertAt = result.length;
    for (let i = 0; i < result.length; i++) {
      if (defaults.indexOf(result[i]) > defIndex) {
        insertAt = i;
        break;
      }
    }
    result.splice(insertAt, 0, id);
  }
  return result;
}
