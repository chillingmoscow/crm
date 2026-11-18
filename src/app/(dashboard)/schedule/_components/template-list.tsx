"use client";

import { ColorDot } from "@/components/ui/color-dot";
import { useEffect, useState } from "react";
import { ArchiveRestore } from "lucide-react";
import { arrayMove } from "@dnd-kit/sortable";
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import {
  Archive,
  CalendarClock,
  Copy,
  Pencil,
  Plus,
  SearchX,
} from "lucide-react";
import {
  DataTable,
  ROW_MENU_COLUMN_SIZE,
  TableConditions,
  TableFilterChip,
  TableSortPicker,
  TableColumnManager,
  TableControls,
  TablePageHeader,
  TablePagination,
  TableRowMenu,
  useTableState,
  type TableRowMenuAction,
} from "@/components/shared/table";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { shiftTemplateLabel, type ShiftTemplate } from "@/lib/schedule/types";
import { templateTimesFor } from "@/lib/schedule/template-times";
import { TemplateName } from "./template-name";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";

// Время — семь колонок Пн…Вс: в заголовке день, в ячейке начало и конец.
const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;
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
            icon: template.archived ? <ArchiveRestore /> : <Archive />,
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
      <Breadcrumbs
        items={[{ label: "График работы" }, { label: "Шаблоны смен" }]}
      />
      <TablePageHeader
        title="Шаблоны смен"
        count={rows.length}
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
              active: archived,
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
      <TableConditions
        label="Условия списка шаблонов смен"
        open={filtersVisible}
        hasFilters={archived}
        sorting={state.sorting}
        onSortingChange={table.setSorting}
        sortFields={[...sortable]}
        sortLabels={labels}
        search={state.search}
        onSearchClear={() => {
          state.setSearch("");
          firstPage();
        }}
        onReset={() => {
          setStatus("");
          state.setSearch("");
          table.setSorting([]);
          firstPage();
        }}
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
      </TableConditions>
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
          <DataTable
            table={table}
            label="Шаблоны смен"
            labels={labels}
            onColumnSizingChange={state.setColumnSizing}
            sorting={state.sorting}
            onSortingChange={table.setSorting}
            sortable={sortable}
            onRowClick={canEdit ? (row) => onEdit(row.original) : undefined}
            empty={null}
            mobile={{ label: "Карточки шаблонов смен", nameColumn: "name" }}
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
