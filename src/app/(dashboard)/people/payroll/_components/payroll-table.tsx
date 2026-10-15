"use client";
import { useMemo, useEffect, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  TableControls,
  TableColumnManager,
  TablePagination,
  ResizableTableHead,
  useTableState,
} from "@/components/shared/table";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
const noHiddenColumns: string[] = [];
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
  hiddenColumns = noHiddenColumns,
  toolbarTargetId,
  externalSearch,
  filters,
  defaultSortDesc,
  exportAction,
  scrollMode = "contained",
  minWidth = 600,
}: {
  id: string;
  rows: T[];
  columns: ColumnDef<T>[];
  labels: Record<string, string>;
  numeric?: string[];
  searchText: (row: T) => string;
  onRow?: (row: T) => void;
  actions?: React.ReactNode;
  defaultSort?: string;
  hiddenColumns?: string[];
  toolbarTargetId?: string;
  externalSearch?: { value: string; onChange: (value: string) => void };
  filters?: { active?: boolean; content: React.ReactNode };
  defaultSortDesc?: boolean;
  exportAction?: { label: string; onClick: () => void };
  scrollMode?: "contained" | "page";
  minWidth?: number;
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
  const { setSorting } = st;
  useEffect(() => {
    setSorting([
      { id: defaultSort, desc: defaultSortDesc ?? defaultSort === "date" },
    ]);
  }, [id, defaultSort, defaultSortDesc, setSorting]);
  const searchValue = externalSearch?.value ?? st.search;
  const filtered = useMemo(
    () =>
      rows.filter((r) =>
        searchText(r)
          .toLocaleLowerCase("ru-RU")
          .includes(searchValue.toLocaleLowerCase("ru-RU")),
      ),
    [rows, searchText, searchValue],
  );
  const table = useReactTable({
    data: filtered,
    columns,
    state: {
      sorting: st.sorting,
      pagination: st.pagination,
      columnVisibility: st.columnVisibility,
      columnOrder: st.columnOrder,
      columnSizing: st.columnSizing,
    },
    onSortingChange: st.setSorting,
    onPaginationChange: st.setPagination,
    onColumnVisibilityChange: st.setColumnVisibility,
    onColumnSizingChange: st.setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    columnResizeMode: "onChange",
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
  const sort = (id: string, additive = false) =>
    st.setSorting((old) => {
      const existing = old.find((s) => s.id === id);
      const next = !existing
        ? { id, desc: false }
        : !existing.desc
          ? { id, desc: true }
          : null;
      if (!additive) return next ? [next] : [];
      return !existing
        ? [...old, { id, desc: false }]
        : next
          ? old.map((s) => (s.id === id ? next : s))
          : old.filter((s) => s.id !== id);
    });
  const controls = (
    <div className="flex flex-wrap justify-end gap-2">
      <TableControls
        search={{
          value: searchValue,
          onChange: (v) => {
            if (externalSearch) externalSearch.onChange(v);
            else st.setSearch(v);
            st.setPagination((p) => ({ ...p, pageIndex: 0 }));
          },
          open: st.searchOpen,
          onOpenChange: st.setSearchOpen,
          placeholder: "Сотрудник или должность",
        }}
        filters={filters}
        sort={{
          active: !!st.sorting.length,
          content: (
            <div className="w-72 space-y-2 p-3">
              <div className="flex items-center justify-between text-sm font-medium">
                Сортировка
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => st.setSorting([])}
                >
                  Сбросить
                </button>
              </div>
              {st.sorting.map((item, index) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-md border p-2 text-sm"
                >
                  <span className="text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {labels[item.id]}
                  </span>
                  <button
                    aria-label={`Изменить направление: ${labels[item.id]}`}
                    onClick={() =>
                      st.setSorting((old) =>
                        old.map((s) =>
                          s.id === item.id ? { ...s, desc: !s.desc } : s,
                        ),
                      )
                    }
                  >
                    {item.desc ? "↓" : "↑"}
                  </button>
                  <button
                    aria-label={`Повысить приоритет: ${labels[item.id]}`}
                    disabled={!index}
                    className="disabled:opacity-25"
                    onClick={() =>
                      st.setSorting((old) => arrayMove(old, index, index - 1))
                    }
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`Убрать сортировку: ${labels[item.id]}`}
                    onClick={() =>
                      st.setSorting((old) =>
                        old.filter((s) => s.id !== item.id),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <select
                aria-label="Добавить уровень сортировки"
                className="w-full rounded-md border bg-background p-2 text-sm"
                value=""
                onChange={(e) => {
                  if (e.target.value) sort(e.target.value, true);
                }}
              >
                <option value="">Добавить уровень…</option>
                {Object.entries(labels)
                  .filter(
                    ([id]) =>
                      id !== "actions" && !st.sorting.some((s) => s.id === id),
                  )
                  .map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Клик по заголовку задаёт основной порядок. Shift + клик
                добавляет уровень.
              </p>
            </div>
          ),
        }}
        columns={{
          content: (
            <TableColumnManager
              columns={table.getAllLeafColumns().map((c) => ({
                id: c.id,
                label: labels[c.id],
                visible: c.getIsVisible(),
                canHide: c.id !== "employee",
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
  return (
    <div className="space-y-4 min-w-0">
      {toolbarTargetId
        ? toolbarTarget
          ? createPortal(controls, toolbarTarget)
          : null
        : controls}
      <div className="overflow-hidden rounded-xl border">
        <div
          data-payroll-scroll={scrollMode}
          className={cn(
            "overflow-x-auto",
            scrollMode === "contained" && "max-h-[65dvh] overflow-y-auto",
          )}
        >
          <table
            // TableConvert adds attributes before hydration; allow its table annotations.
            suppressHydrationWarning
            className="w-full table-fixed text-[13px] [&_thead]:text-xs [&_tbody_td]:px-4 [&_tbody_td]:py-4"
            style={{ minWidth: Math.max(minWidth, table.getTotalSize()) }}
          >
            <ResizableTableHead
              table={table}
              isControlColumn={() => false}
              isRightAligned={(id) => numeric.includes(id)}
              sortableColumnIds={
                new Set(Object.keys(labels).filter((id) => id !== "actions"))
              }
              onSort={(id, event) => sort(id, event.shiftKey)}
              headerIndicator={(id) => {
                const s = st.sorting.find((s) => s.id === id);
                return s ? (
                  <span className="inline-flex items-center gap-0.5">
                    {s.desc ? (
                      <ArrowDown className="h-3 w-3" />
                    ) : (
                      <ArrowUp className="h-3 w-3" />
                    )}
                    {st.sorting.length > 1 && (
                      <small>
                        {st.sorting.findIndex((sort) => sort.id === id) + 1}
                      </small>
                    )}
                  </span>
                ) : null;
              }}
              headerAriaSort={(id) => {
                const s = st.sorting.find((s) => s.id === id);
                return s ? (s.desc ? "descending" : "ascending") : "none";
              }}
            />
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b last:border-0 hover:bg-muted/40",
                    onRow && "cursor-pointer",
                  )}
                  onClick={() => onRow?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={cn(
                        "px-3 py-4",
                        numeric.includes(cell.column.id) &&
                          "text-right tabular-nums",
                      )}
                    >
                      {onRow && cell.column.id === "employee" ? (
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRow(row.original);
                          }}
                          aria-label={`Открыть ${searchText(row.original)}`}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </button>
                      ) : (
                        flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="p-12 text-center text-muted-foreground"
                  >
                    Нет записей за выбранный период
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
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
