"use client";

import { ColorDot } from "@/components/ui/color-dot";
import { useEffect, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
  type OnChangeFn,
  type Table,
} from "@tanstack/react-table";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Copy,
  Pencil,
  Plus,
  SearchX,
} from "lucide-react";
import { PeopleMobileCards } from "@/components/people/people-mobile-cards";
import styles from "@/components/people/people-table.module.css";
import {
  ROW_MENU_COLUMN_SIZE,
  ResizableTableHead,
  TableColumnManager,
  TableControls,
  TablePageHeader,
  TablePagination,
  TableRowMenu,
  useTableState,
  type TableRowMenuAction,
} from "@/components/shared/table";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import { TableFilterChip } from "@/components/shared/table/table-filter-chip";
import { TableSortPicker } from "@/components/shared/table/table-sort-settings";
import { useTableColumnResize } from "@/components/shared/table/use-table-column-resize";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { shiftTemplateLabel, type ShiftTemplate } from "@/lib/schedule/types";
import { templateTimesFor } from "@/lib/schedule/template-times";
import { TemplateName } from "./template-name";

// Время — семь колонок ПН…ВС: в заголовке день, в ячейке начало и конец.
const DAYS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"] as const;
const dayId = (i: number) => `day${i + 1}`;
const labels: Record<string, string> = {
  name: "Название",
  ...Object.fromEntries(DAYS.map((d, i) => [dayId(i), d])),
};
const config = [
  { id: "name", defaultSize: 260 },
  ...DAYS.map((_, i) => ({ id: dayId(i), defaultSize: 76 })),
];
const sortable = new Set(["name"]);
const collator = new Intl.Collator("ru", {
  numeric: true,
  sensitivity: "base",
});

export function TemplateList({
  templates,
  tableId,
  can,
  onCreate,
  onEdit,
  onCopy,
  onArchive,
}: {
  templates: ShiftTemplate[];
  tableId: string;
  can: (permission: string) => boolean;
  onCreate: () => void;
  onEdit: (template: ShiftTemplate) => void;
  onCopy: (template: ShiftTemplate) => void;
  onArchive: (template: ShiftTemplate) => void;
}) {
  const state = useTableState({ tableId, columns: config });
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [status, setStatus] = useState("");
  const archived = status === "archived";
  const query = state.search.trim().toLocaleLowerCase("ru");
  const canEdit = can("template_edit");
  const canCreate = can("template_create");
  const rows = templates.filter(
    (template) =>
      template.archived === archived &&
      shiftTemplateLabel(template).toLocaleLowerCase("ru").includes(query),
  );
  const firstPage = () =>
    state.setPagination((page) => ({ ...page, pageIndex: 0 }));
  const actions = (template: ShiftTemplate): TableRowMenuAction[] => [
    ...(canEdit
      ? [
          {
            label: "Изменить",
            icon: <Pencil />,
            onSelect: () => onEdit(template),
          },
        ]
      : []),
    ...(can("template_copy")
      ? [
          {
            label: "Создать копию",
            icon: <Copy />,
            onSelect: () => onCopy(template),
          },
        ]
      : []),
    ...(can("template_archive")
      ? [
          {
            label: template.archived ? "Восстановить" : "В архив",
            icon: <Archive />,
            onSelect: () => onArchive(template),
            separatorBefore: true,
          },
        ]
      : []),
  ];
  const columns: ColumnDef<ShiftTemplate>[] = [
    {
      accessorKey: "name",
      header: labels.name,
      size: 260,
      minSize: 144,
      enableHiding: false,
      sortingFn: (a, b) => collator.compare(shiftTemplateLabel(a.original), shiftTemplateLabel(b.original)),
      cell: ({ row }) => {
        const template = row.original;
        return (
          <span className="flex max-w-full items-center gap-2.5">
            <ColorDot color={template.color} />
            <TemplateName {...template} />
          </span>
        );
      },
    },
    ...DAYS.map(
      (label, i): ColumnDef<ShiftTemplate> => ({
        id: dayId(i),
        header: label,
        size: 76,
        minSize: 56,
        enableSorting: false,
        cell: ({ row }) => {
          const times = templateTimesFor(row.original, i + 1);
          return times ? (
            <span className="block text-[13px] leading-tight tabular-nums">
              <span className="block">{times.start_time.slice(0, 5)}</span>
              <span className="block text-muted-foreground">{times.end_time.slice(0, 5)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground/60" aria-label="Не работает">—</span>
          );
        },
      }),
    ),
    {
      id: "actions",
      size: ROW_MENU_COLUMN_SIZE,
      minSize: ROW_MENU_COLUMN_SIZE,
      maxSize: ROW_MENU_COLUMN_SIZE,
      enableHiding: false,
      enableResizing: false,
      cell: ({ row }) => {
        const menu = actions(row.original);
        return menu.length > 0 ? <TableRowMenu actions={menu} /> : null;
      },
    },
  ];
  const { pagination, setPagination } = state;
  const pageCount = Math.max(1, Math.ceil(rows.length / pagination.pageSize));
  const pageIndex = Math.min(pagination.pageIndex, pageCount - 1);
  useEffect(() => {
    if (pagination.pageIndex !== pageIndex)
      setPagination((page) => ({ ...page, pageIndex }));
  }, [pageIndex, pagination.pageIndex, setPagination]);
  const table = useReactTable({
    data: rows,
    columns,
    state: {
      columnVisibility: {
        ...state.columnVisibility,
        name: true,
        actions: true,
      },
      columnOrder: [...state.columnOrder, "actions"],
      columnSizing: state.columnSizing,
      sorting: state.sorting,
      pagination: { ...pagination, pageIndex },
    },
    defaultColumn: { sortDescFirst: false },
    onSortingChange: (next) => {
      state.setSorting(next);
      firstPage();
    },
    onColumnVisibilityChange: state.setColumnVisibility,
    onColumnSizingChange: state.setColumnSizing,
    getRowId: (template) => template.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  });
  const createButton = (
    <Button size="sm" className="h-9 gap-2" onClick={onCreate}>
      <Plus className="size-4" />
      Новый шаблон
    </Button>
  );

  return (
    <div className="space-y-4">
      <PageBreadcrumb>
        <nav
          aria-label="Навигация по разделам"
          className="flex min-w-0 items-center gap-2 text-sm"
        >
          <span className="text-muted-foreground">График работы</span>
          <span aria-hidden="true" className="text-muted-foreground">
            /
          </span>
          <span className="truncate">Шаблоны смен</span>
        </nav>
      </PageBreadcrumb>
      <TablePageHeader
        title="Шаблоны смен"
        count={rows.length}
        className="md:flex-wrap md:items-center [&>div:last-child]:max-w-full"
        actions={
          <TableControls
            search={{
              value: state.search,
              onChange: (value) => {
                state.setSearch(value);
                firstPage();
              },
              open: state.searchOpen,
              onOpenChange: state.setSearchOpen,
              placeholder: "Найти шаблон смены",
            }}
            filters={{
              active: filtersVisible || archived,
              onClick: () => setFiltersVisible((visible) => !visible),
            }}
            sort={{
              active: state.sorting.length > 0,
              content: (
                <TableSortPicker
                  sorting={state.sorting}
                  onChange={table.setSorting}
                  fields={[...sortable]}
                  labels={labels}
                />
              ),
            }}
            columns={{
              content: (
                <TableColumnManager
                  columns={state.columnOrder.map((id) => {
                    const column = table.getColumn(id)!;
                    return {
                      id,
                      label: labels[id],
                      visible: column.getIsVisible(),
                      canHide: column.getCanHide(),
                    };
                  })}
                  onVisibilityChange={(id, visible) =>
                    table.getColumn(id)?.toggleVisibility(visible)
                  }
                  onMoveColumn={(from, to) =>
                    state.setColumnOrder((order) =>
                      arrayMove(order, order.indexOf(from), order.indexOf(to)),
                    )
                  }
                  onReset={state.resetColumns}
                />
              ),
            }}
            primaryActions={canCreate ? createButton : null}
          />
        }
      />
      {(filtersVisible || archived) && (
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label="Фильтры шаблонов смен"
        >
          <TableFilterChip
            label="Статус"
            value={status}
            onChange={(value) => {
              setStatus(value);
              firstPage();
            }}
            options={[
              { value: "", label: "Активные" },
              { value: "archived", label: "Архив" },
            ]}
          />
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState
          icon={query ? SearchX : archived ? Archive : CalendarClock}
          title={
            query
              ? "Шаблоны не найдены"
              : archived
                ? "Архив пуст"
                : "Шаблонов смен пока нет"
          }
          description={
            query
              ? "Попробуйте изменить название в поиске."
              : archived
                ? "Сюда попадают шаблоны, отправленные в архив."
                : "Создайте шаблон, чтобы подставлять время и параметры при добавлении смен."
          }
          action={
            query ? (
              <Button
                variant="outline"
                onClick={() => {
                  state.setSearch("");
                  firstPage();
                }}
              >
                Сбросить поиск
              </Button>
            ) : !archived && canCreate ? (
              createButton
            ) : undefined
          }
        />
      ) : (
        <>
          <TemplateTable
            table={table}
            onColumnSizingChange={state.setColumnSizing}
            onOpen={canEdit ? onEdit : undefined}
          />
          <PeopleMobileCards
            table={table}
            label="Карточки шаблонов смен"
            nameColumn="name"
            photoColumn="__none"
            roleColumn="__none"
            onOpen={canEdit ? (row) => onEdit(row.original) : undefined}
            labels={labels}
            empty={null}
          />
          <TablePagination
            pageIndex={pageIndex}
            pageSize={pagination.pageSize}
            total={rows.length}
            onPageChange={(index) =>
              setPagination((page) => ({ ...page, pageIndex: index }))
            }
            onPageSizeChange={(pageSize) =>
              setPagination({ pageSize, pageIndex: 0 })
            }
          />
        </>
      )}
    </div>
  );
}

function TemplateTable({
  table,
  onColumnSizingChange,
  onOpen,
}: {
  table: Table<ShiftTemplate>;
  onColumnSizingChange: OnChangeFn<ColumnSizingState>;
  /** Клик по строке целиком открывает шаблон (кроме кнопок в строке). */
  onOpen?: (template: ShiftTemplate) => void;
}) {
  const { tableRef, onResizeStart, columnWidths, minTableWidth } =
    useTableColumnResize(table, onColumnSizingChange);
  return (
    <div className={styles.scroll}>
      <table
        ref={tableRef}
        className={styles.table}
        style={{ minWidth: minTableWidth }}
        aria-label="Шаблоны смен"
      >
        <ResizableTableHead
          table={table}
          columnWidths={columnWidths}
          onResizeStart={onResizeStart}
          isControlColumn={(id) => id === "actions"}
          sortableColumnIds={sortable}
          onSort={(id) => table.getColumn(id)?.toggleSorting(undefined, true)}
          headerAriaSort={(id) => {
            if (!sortable.has(id)) return undefined;
            const direction = table.getColumn(id)?.getIsSorted();
            return direction === "asc"
              ? "ascending"
              : direction === "desc"
                ? "descending"
                : "none";
          }}
          headerIndicator={(id) => {
            const column = table.getColumn(id);
            const direction = column?.getIsSorted();
            if (!column || !direction) return null;
            const Icon = direction === "desc" ? ArrowDown : ArrowUp;
            return (
              <span className="inline-flex items-center gap-0.5">
                <Icon className="size-3" />
                {table.getState().sorting.length > 1 && (
                  <span className="text-[10px]">
                    {column.getSortIndex() + 1}
                  </span>
                )}
              </span>
            );
          }}
        />
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className={onOpen ? "cursor-pointer" : undefined}
              onClick={(event) => {
                if (onOpen && !(event.target as HTMLElement).closest("button,a,input,[role=menu]"))
                  onOpen(row.original);
              }}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
