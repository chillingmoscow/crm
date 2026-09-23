"use client";

import { flexRender, type Header, type Table as TanStackTable } from "@tanstack/react-table";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * `<colgroup>` + `<thead>` списочной таблицы на TanStack: доли ширины,
 * липкая шапка, сортировка по клику, ручка ресайза.
 *
 * Ширины — проценты от `getTotalSize()`, а не пиксели: колонки всегда
 * вписаны в контейнер без горизонтального скролла, ресайз меняет доли.
 *
 * Сам `<table>` остаётся у вызывающего — у списка актов и у итогов разные
 * className и min-width.
 */
export function ResizableTableHead<TData>({
  table,
  isControlColumn,
  isRightAligned,
  sortableColumnIds,
  onSort,
  headerIndicator,
  headerAriaSort,
  renderControlHeader,
}: {
  table: TanStackTable<TData>;
  /** Служебные колонки: без сортировки и без ручки ресайза (чекбокс, «⋯»). */
  isControlColumn: (columnId: string) => boolean;
  isRightAligned?: (columnId: string) => boolean;
  sortableColumnIds: Set<string>;
  onSort: (columnId: string) => void;
  headerIndicator: (columnId: string) => ReactNode;
  headerAriaSort: (columnId: string) => "ascending" | "descending" | "none" | undefined;
  /** Содержимое шапки служебной колонки. По умолчанию — пусто. */
  renderControlHeader?: (header: Header<TData, unknown>) => ReactNode;
}) {
  return (
    <>
      <colgroup>
        {table.getVisibleLeafColumns().map((column) => (
          <col
            key={column.id}
            style={{ width: `${(column.getSize() / table.getTotalSize()) * 100}%` }}
          />
        ))}
      </colgroup>
      <thead className="group/header sticky top-0 z-20 bg-muted [&_th]:bg-muted text-xs font-medium tracking-wide text-muted-foreground">
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id} className="h-11">
            {headerGroup.headers.map((header) => {
              const columnId = header.column.id;
              const isControl = isControlColumn(columnId);
              const isSortable = !isControl && sortableColumnIds.has(columnId);
              return (
                <th
                  key={header.id}
                  aria-sort={headerAriaSort(columnId)}
                  className={cn(
                    "relative border-b px-3 py-3",
                    isRightAligned?.(columnId) ? "text-right" : "text-left",
                  )}
                >
                  {isControl ? (
                    (renderControlHeader?.(header) ?? null)
                  ) : isSortable ? (
                    <button
                      type="button"
                      className="flex max-w-full items-center gap-1 truncate hover:text-foreground"
                      onClick={() => onSort(columnId)}
                    >
                      <span className="truncate">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </span>
                      {headerIndicator(columnId)}
                    </button>
                  ) : (
                    <span className="truncate">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </span>
                  )}
                  {header.column.getCanResize() && !isControl ? (
                    <div
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      className="absolute -right-1 top-0 z-10 flex h-full w-2 cursor-col-resize select-none items-stretch justify-center touch-none"
                    >
                      <span
                        className={cn(
                          "my-2 w-px rounded-full bg-border opacity-0 transition-[width,background-color,opacity]",
                          "group-hover/header:opacity-80",
                          "hover:w-1 hover:bg-brand hover:opacity-100",
                          header.column.getIsResizing() ? "w-1 bg-brand opacity-100" : null,
                        )}
                      />
                    </div>
                  ) : null}
                </th>
              );
            })}
          </tr>
        ))}
      </thead>
    </>
  );
}
