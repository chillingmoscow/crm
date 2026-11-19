"use client";
import { useMemo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import {
  DataTable,
  TableColumnManager,
  TableConditions,
  TableControls,
  TablePagination,
  TableSortPicker,
  useTableState,
} from "@/components/shared/table";
import { Checkbox } from "@/components/ui/checkbox";

const noHiddenColumns: string[] = [];

/** Чипы фильтров для ряда условий; `active` — выбран хотя бы один фильтр. */
export type PayrollTableFilters = {
  active: boolean;
  chips: React.ReactNode;
  onReset: () => void;
};

/** Выбор строк для массовых действий: чекбокс в первом столбце. */
export type PayrollTableSelection<T> = {
  value: RowSelectionState;
  onChange: OnChangeFn<RowSelectionState>;
  getRowId: (row: T) => string;
  canSelect: (row: T) => boolean;
  /** Доступное имя чекбокса строки: «Выбрать выход: …». */
  rowLabel: (row: T) => string;
  /** Доступное имя чекбокса «все на странице». */
  pageLabel: string;
};

/**
 * Таблицы «Зарплаты» на общем каркасе `DataTable`. Состояние столбцов и
 * страницы — `useTableState`; сортировка по умолчанию не навязывается:
 * `defaultSort` задаёт только порядок строк, пока пользователь сам ничего не
 * отсортировал, и не показывается пином.
 */
export function PayrollTable<T>({
  id,
  rows,
  columns,
  labels,
  numeric = [],
  searchText,
  onRow,
  actions,
  defaultSort = "employee",
  defaultSortDesc,
  hiddenColumns = noHiddenColumns,
  toolbarTargetId,
  externalSearch,
  filters,
  exportAction,
  label,
  empty,
  totals,
  selection,
  emptyText = "Нет записей за выбранный период",
}: {
  id: string;
  rows: T[];
  columns: ColumnDef<T>[];
  labels: Record<string, string>;
  numeric?: string[];
  searchText: (row: T) => string;
  onRow?: (row: T) => void;
  actions?: React.ReactNode;
  /** Порядок строк, пока сортировка не задана. */
  defaultSort?: string;
  defaultSortDesc?: boolean;
  hiddenColumns?: string[];
  toolbarTargetId?: string;
  externalSearch?: { value: string; onChange: (value: string) => void };
  filters?: PayrollTableFilters;
  exportAction?: { label: string; onClick: () => void; loading?: boolean };
  label?: string;
  /** Блок вместо таблицы, когда строк нет совсем. */
  empty?: React.ReactNode;
  /** Строка итогов по видимым столбцам с учётом поиска и фильтров. */
  totals?: (rows: T[]) => Partial<Record<string, React.ReactNode>>;
  selection?: PayrollTableSelection<T>;
  emptyText?: string;
}) {
  const [toolbarTarget, setToolbarTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setToolbarTarget(
      toolbarTargetId ? document.getElementById(toolbarTargetId) : null,
    );
  }, [toolbarTargetId]);
  const config = useMemo(
    () =>
      Object.keys(labels).map((id) => ({
        id,
        defaultSize: id === "employee" ? 220 : 130,
        defaultVisible: !hiddenColumns.includes(id),
      })),
    [labels, hiddenColumns],
  );
  const st = useTableState({ tableId: id, columns: config });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchValue = externalSearch?.value ?? st.search;
  const setSearch = (v: string) => {
    if (externalSearch) externalSearch.onChange(v);
    else st.setSearch(v);
    st.setPagination((p) => ({ ...p, pageIndex: 0 }));
  };
  const filtered = useMemo(
    () =>
      rows.filter((r) =>
        searchText(r)
          .toLocaleLowerCase("ru-RU")
          .includes(searchValue.toLocaleLowerCase("ru-RU")),
      ),
    [rows, searchText, searchValue],
  );
  const sortable = Object.keys(labels).filter((id) => id !== "actions");
  const nameColumn = labels.employee ? "employee" : Object.keys(labels)[0];
  // onRow и searchText вызывающие передают стрелками прямо в JSX. Через ref
  // ячейка остаётся той же функцией между рендерами: иначе flexRender
  // монтирует её заново (кнопка теряет фокус, аватары перерисовываются
  // на каждый символ поиска).
  const onRowRef = useRef(onRow);
  onRowRef.current = onRow;
  const searchTextRef = useRef(searchText);
  searchTextRef.current = searchText;
  const clickable = !!onRow;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const selectable = !!selection;
  const tableColumns = useMemo(() => {
    const withSelect: ColumnDef<T>[] = selectable
      ? [
          {
            id: "select",
            size: 44,
            minSize: 44,
            maxSize: 44,
            enableHiding: false,
            enableResizing: false,
            enableSorting: false,
            cell: ({ row }) => (
              <Checkbox
                checked={row.getIsSelected()}
                disabled={!row.getCanSelect()}
                onCheckedChange={(checked) => row.toggleSelected(checked === true)}
                aria-label={selectionRef.current?.rowLabel(row.original)}
                className="align-middle"
              />
            ),
          },
          ...columns,
        ]
      : columns;
    return clickable
        ? withSelect.map((column) =>
            column.id === "employee" && column.cell
              ? ({
                  ...column,
                  cell: (ctx) => {
                    const render = column.cell;
                    return (
                      <button
                        type="button"
                        className="w-full min-w-0 text-left"
                        onClick={() => onRowRef.current?.(ctx.row.original)}
                        aria-label={`Открыть: ${searchTextRef.current(ctx.row.original)}`}
                      >
                        {typeof render === "function" ? render(ctx) : render}
                      </button>
                    );
                  },
                } satisfies ColumnDef<T>)
              : column,
          )
        : withSelect;
  }, [columns, clickable, selectable]);
  const changeSorting = (next: SortingState) => {
    st.setSorting(next);
    st.setPagination((p) => ({ ...p, pageIndex: 0 }));
  };
  const table = useReactTable({
    data: filtered,
    columns: tableColumns,
    state: {
      // Без сортировки пользователя строки идут в порядке defaultSort,
      // но пина и стрелки в заголовке нет: это порядок, а не условие.
      sorting: st.sorting.length
        ? st.sorting
        : labels[defaultSort]
          ? [{ id: defaultSort, desc: defaultSortDesc ?? defaultSort === "date" }]
          : [],
      pagination: st.pagination,
      columnVisibility: st.columnVisibility,
      columnOrder: selection ? ["select", ...st.columnOrder] : st.columnOrder,
      columnSizing: st.columnSizing,
      ...(selection ? { rowSelection: selection.value } : {}),
    },
    ...(selection
      ? {
          getRowId: (row: T) => selection.getRowId(row),
          enableRowSelection: (row: { original: T }) => selection.canSelect(row.original),
          onRowSelectionChange: selection.onChange,
        }
      : {}),
    onPaginationChange: st.setPagination,
    onColumnVisibilityChange: st.setColumnVisibility,
    onColumnSizingChange: st.setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  });
  const { setPagination } = st;
  useEffect(() => {
    const lastPage = Math.max(
      0,
      Math.ceil(filtered.length / st.pagination.pageSize) - 1,
    );
    setPagination((current) =>
      current.pageIndex > lastPage
        ? { ...current, pageIndex: lastPage }
        : current,
    );
  }, [filtered.length, st.pagination.pageSize, setPagination]);
  const controls = (
    <div className="flex flex-wrap justify-end gap-2">
      <TableControls
        search={{
          value: searchValue,
          onChange: setSearch,
          open: st.searchOpen,
          onOpenChange: st.setSearchOpen,
          placeholder: "Сотрудник или должность",
        }}
        filters={
          filters
            ? {
                active: filters.active,
                onClick: () => setFiltersOpen((v) => !v),
              }
            : undefined
        }
        sort={{
          active: !!st.sorting.length,
          content: (
            <TableSortPicker
              sorting={st.sorting}
              onChange={changeSorting}
              fields={sortable}
              labels={labels}
            />
          ),
        }}
        columns={{
          content: (
            <TableColumnManager
              columns={table.getAllLeafColumns().map((c) => ({
                id: c.id,
                label: labels[c.id],
                visible: c.getIsVisible(),
                canHide: c.id !== nameColumn,
                width: c.getSize(),
              }))}
              onVisibilityChange={(id, v) =>
                table.getColumn(id)?.toggleVisibility(v)
              }
              onMoveColumn={(a, b) =>
                st.setColumnOrder((old) =>
                  arrayMove(old, old.indexOf(a), old.indexOf(b)),
                )
              }
              onReset={st.resetColumns}
            />
          ),
        }}
        exportAction={exportAction}
        primaryActions={actions}
      />
    </div>
  );
  const visibleRows = table.getSortedRowModel().rows.map((r) => r.original);
  return (
    <div className="min-w-0 space-y-4">
      {toolbarTargetId
        ? toolbarTarget
          ? createPortal(controls, toolbarTarget)
          : null
        : controls}
      <TableConditions
        label={`Условия таблицы «${label ?? "Зарплата"}»`}
        open={filtersOpen}
        hasFilters={!!filters?.active}
        sorting={st.sorting}
        onSortingChange={changeSorting}
        sortFields={sortable}
        sortLabels={labels}
        search={searchValue}
        onSearchClear={() => setSearch("")}
        onReset={() => {
          filters?.onReset();
          setSearch("");
          changeSorting([]);
        }}
      >
        {filters?.chips}
      </TableConditions>
      {!filtered.length && empty ? (
        empty
      ) : (
        <DataTable
          table={table}
          label={label ?? "Зарплата"}
          labels={labels}
          onColumnSizingChange={st.setColumnSizing}
          sorting={st.sorting}
          onSortingChange={changeSorting}
          sortable={sortable}
          numeric={numeric}
          onRowClick={onRow ? (row) => onRow(row.original) : undefined}
          renderControlHeader={
            selection
              ? (header) =>
                  header.column.id === "select" ? (
                    <Checkbox
                      checked={
                        table.getIsAllPageRowsSelected() ||
                        (table.getIsSomePageRowsSelected() && "indeterminate")
                      }
                      onCheckedChange={(checked) =>
                        table.toggleAllPageRowsSelected(checked === true)
                      }
                      disabled={!table.getRowModel().rows.some((row) => row.getCanSelect())}
                      aria-label={selection.pageLabel}
                      className="align-middle"
                    />
                  ) : null
              : undefined
          }
          empty={emptyText}
          totals={totals?.(visibleRows)}
          mobile={{
            nameColumn,
            statusColumn: labels.status ? "status" : undefined,
            // С чекбоксом в шапке карточки действия строки уходят в подвал.
            actionsPlacement: selection ? "footer" : undefined,
            selection: selection && table.getRowModel().rows.some((row) => row.getCanSelect()) ? (
              <label className="flex min-h-10 items-center gap-3 text-sm text-muted-foreground">
                <Checkbox
                  checked={
                    table.getIsAllPageRowsSelected() ||
                    (table.getIsSomePageRowsSelected() && "indeterminate")
                  }
                  onCheckedChange={(checked) =>
                    table.toggleAllPageRowsSelected(checked === true)
                  }
                  aria-label={selection.pageLabel}
                />
                Выбрать все на странице
              </label>
            ) : undefined,
          }}
        />
      )}
      <TablePagination
        pageIndex={st.pagination.pageIndex}
        pageSize={st.pagination.pageSize}
        total={filtered.length}
        hiddenCount={rows.length - filtered.length}
        onPageChange={(pageIndex) =>
          st.setPagination((p) => ({ ...p, pageIndex }))
        }
        onPageSizeChange={(pageSize) =>
          st.setPagination({ pageIndex: 0, pageSize })
        }
      />
    </div>
  );
}
