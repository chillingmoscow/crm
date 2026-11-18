"use client";

import type { ReactNode } from "react";
import {
  flexRender,
  type Header,
  type OnChangeFn,
  type ColumnSizingState,
  type Row,
  type SortingState,
  type Table,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { isRowNavigationClick } from "./row-click";
import { ResizableTableHead } from "./table-head";
import { TableMobileCards } from "./table-mobile-cards";
import { useTableColumnResize } from "./use-table-column-resize";
import styles from "./data-table.module.css";

/**
 * Клик по заголовку: пусто → по возрастанию → по убыванию → убрать.
 * Остальные сортировки сохраняются: клик добавляет уровень, а не заменяет.
 */
export function cycleHeaderSort(
  sorting: SortingState,
  id: string,
): SortingState {
  const current = sorting.find((s) => s.id === id);
  if (!current) return [...sorting, { id, desc: false }];
  if (!current.desc)
    return sorting.map((s) => (s.id === id ? { ...s, desc: true } : s));
  return sorting.filter((s) => s.id !== id);
}

type MobileCardsConfig = {
  /** Подпись секции карточек для скринридера. */
  label?: string;
  /** Строка над карточками: «Выбрать все на странице». */
  selection?: ReactNode;
  nameColumn: string;
  photoColumn?: string;
  roleColumn?: string;
  statusColumn?: string;
  actionsPlacement?: "header" | "footer";
};

/**
 * Единый каркас таблицы списка (design-system § «List-страница»):
 * карточка `border bg-card` с радиусом 8, шапка 44px 12/500 закреплена к окну,
 * строки 60px 14/20 с отступом 12, ширины долями без горизонтальной прокрутки,
 * на телефоне — карточки. Состояние (сортировка, столбцы, страница) живёт в
 * `useTableState` у вызывающего; здесь только отрисовка.
 */
export function DataTable<T>({
  table,
  label,
  labels,
  onColumnSizingChange,
  sorting,
  onSortingChange,
  sortable,
  numeric = [],
  controlColumns = ["select", "actions"],
  renderControlHeader,
  onRowClick,
  rowClassName,
  empty,
  totals,
  mobile,
}: {
  table: Table<T>;
  /** Доступное имя таблицы. */
  label: string;
  /** Подписи столбцов: заголовки в карточках на телефоне. */
  labels: Record<string, string>;
  onColumnSizingChange: OnChangeFn<ColumnSizingState>;
  sorting?: SortingState;
  onSortingChange?: (next: SortingState) => void;
  /** Столбцы, сортируемые кликом по заголовку. */
  sortable?: ReadonlySet<string> | readonly string[];
  /** Числа и суммы: вправо, `tabular-nums`, заголовок тоже вправо. */
  numeric?: readonly string[];
  /** Служебные столбцы без сортировки и ресайза. */
  controlColumns?: readonly string[];
  /** Шапка служебного столбца: обычно флажок «выбрать все». */
  renderControlHeader?: (header: Header<T, unknown>) => ReactNode;
  /** Кликается вся строка; первая ячейка должна сама содержать ссылку или кнопку. */
  onRowClick?: (row: Row<T>) => void;
  rowClassName?: (row: Row<T>) => string | undefined;
  /** Текст или блок вместо строк, когда строк нет. */
  empty: ReactNode;
  /** Строка итогов по видимым столбцам: значения по id столбца. */
  totals?: Partial<Record<string, ReactNode>>;
  /** Карточки на телефоне (до 640px): таблица там скрыта, поэтому они обязательны. */
  mobile: MobileCardsConfig;
}) {
  const { tableRef, onResizeStart, columnWidths, minTableWidth, overflowing } =
    useTableColumnResize(table, onColumnSizingChange);
  const sortableSet = new Set<string>(sortable ?? []);
  const isNumeric = (id: string) => numeric.includes(id);
  const rows = table.getRowModel().rows;
  const visibleColumns = table.getVisibleLeafColumns();
  const sortState = sorting ?? [];
  return (
    <>
      <div className={cn(styles.scroll, overflowing && styles.scrollX)}>
        <table
          ref={tableRef}
          className={styles.table}
          style={{ minWidth: minTableWidth }}
          aria-label={label}
        >
          <ResizableTableHead
            table={table}
            onResizeStart={onResizeStart}
            columnWidths={columnWidths}
            isControlColumn={(id) => controlColumns.includes(id)}
            isRightAligned={isNumeric}
            renderControlHeader={renderControlHeader}
            sortableColumnIds={sortableSet}
            onSort={(id) => onSortingChange?.(cycleHeaderSort(sortState, id))}
            headerAriaSort={(id) => {
              if (!sortableSet.has(id)) return undefined;
              const s = sortState.find((s) => s.id === id);
              return s ? (s.desc ? "descending" : "ascending") : "none";
            }}
            headerIndicator={(id) => {
              const i = sortState.findIndex((s) => s.id === id);
              return i < 0 ? null : (
                <span className="inline-flex items-center gap-0.5">
                  {sortState[i].desc ? (
                    <ArrowDown className="size-3" />
                  ) : (
                    <ArrowUp className="size-3" />
                  )}
                  {sortState.length > 1 && (
                    <span className="text-xs">{i + 1}</span>
                  )}
                </span>
              );
            }}
          />
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  onRowClick && "cursor-pointer",
                  rowClassName?.(row),
                )}
                data-state={row.getIsSelected() ? "selected" : undefined}
                onClick={
                  onRowClick
                    ? (e) => {
                        if (isRowNavigationClick(e))
                          onRowClick(row);
                      }
                    : undefined
                }
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    data-control-cell={
                      controlColumns.includes(cell.column.id) || undefined
                    }
                    className={
                      isNumeric(cell.column.id)
                        ? "text-right tabular-nums"
                        : undefined
                    }
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td
                  colSpan={visibleColumns.length}
                  className="!h-32 text-center text-muted-foreground"
                >
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
          {totals && rows.length > 0 && (
            <tfoot className={styles.totals}>
              <tr>
                {visibleColumns.map((column, index) => (
                  <td
                    key={column.id}
                    className={
                      isNumeric(column.id)
                        ? "text-right tabular-nums"
                        : undefined
                    }
                  >
                    {totals[column.id] ?? (index === 0 ? "Итого" : null)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <TableMobileCards
        table={table}
        label={mobile.label ?? label}
        nameColumn={mobile.nameColumn}
        photoColumn={mobile.photoColumn}
        roleColumn={mobile.roleColumn}
        statusColumn={mobile.statusColumn}
        selection={mobile.selection}
        actionsPlacement={mobile.actionsPlacement}
        labels={labels}
        onOpen={onRowClick}
        empty={empty}
      />
    </>
  );
}
