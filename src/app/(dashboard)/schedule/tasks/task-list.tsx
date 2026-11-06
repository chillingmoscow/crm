"use client";
import { useEffect, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  Camera,
  ListChecks,
  Pencil,
  Plus,
  SearchX,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TableColumnManager,
  TableIconButton,
  TableControls,
  TablePageHeader,
  TablePagination,
  TableRowMenu,
  ResizableTableHead,
  useTableState,
} from "@/components/shared/table";
import { TableFilterChip } from "@/components/shared/table/table-filter-chip";
import { TableSortPicker } from "@/components/shared/table/table-sort-settings";
import { useTableColumnResize } from "@/components/shared/table/use-table-column-resize";
import { PeopleMobileCards } from "@/components/people/people-mobile-cards";
import styles from "@/components/people/people-table.module.css";
import type { TaskData, TaskDefinition } from "@/lib/schedule/tasks";
import { cn } from "@/lib/utils";
import { DeleteTaskDialog } from "./delete-task-dialog";

const definitions = [
  { id: "name", label: "Задача", size: 400, min: 260 },
  { id: "assignee", label: "Шаблон смены", size: 220, min: 150 },
  { id: "recurrence", label: "Повторение", size: 190, min: 150 },
  { id: "review", label: "Приёмка", size: 110, min: 100 },
  { id: "status", label: "Статус", size: 140, min: 110 },
];
const config = definitions.map((c) => ({
  id: c.id,
  defaultSize: c.size,
  defaultVisible: true,
}));
const labels = Object.fromEntries(definitions.map((c) => [c.id, c.label]));
const sortable = new Set(definitions.map((c) => c.id));
const collator = new Intl.Collator("ru", {
  numeric: true,
  sensitivity: "base",
});
function Hint({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip delayDuration={450}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}
export function TaskList({
  data,
  onOpen,
  onCreate,
  onSettings,
  onRefresh,
}: {
  data: TaskData;
  onOpen: (task: TaskDefinition) => void;
  onCreate?: () => void;
  onSettings?: () => void;
  onRefresh: () => Promise<unknown>;
}) {
  const st = useTableState({
    tableId: `schedule.tasks.${data.userId}.${data.venueId ?? data.definitions[0]?.venue_id ?? "venue"}`,
    columns: config,
    defaultPageSize: 25,
  });
  const [filtersVisible, setFiltersVisible] = useState(false),
    [shift, setShift] = useState(""),
    [status, setStatus] = useState(""),
    [deleting, setDeleting] = useState<TaskDefinition | null>(null);
  const manage = data.permissions.includes("schedule.checklist_edit");
  const assignee = (t: TaskDefinition) =>
    data.templates.find((x) => x.id === t.template_id)?.name ?? "Не назначено";
  const recurrence = (t: TaskDefinition) =>
    t.recurrence
      ? `Раз в ${t.recurrence.interval} ${t.recurrence.unit === "week" ? "нед." : "мес."}`
      : "Не настроено";
  const q = st.search.trim().toLocaleLowerCase("ru"),
    active = !!shift || !!status;
  const rows = data.definitions.filter(
    (t) =>
      !t.deleted_at &&
      (!shift || t.template_id === shift) &&
      (!status || t.enabled === (status === "enabled")) &&
      (!q || `${t.name} ${assignee(t)}`.toLocaleLowerCase("ru").includes(q)),
  );
  const actions = (task: TaskDefinition) => [
    { label: "Открыть задачу", icon: <Pencil />, onSelect: () => onOpen(task) },
    ...(manage
      ? [
          {
            label: "Удалить задачу",
            icon: <Trash2 />,
            destructive: true,
            separatorBefore: true,
            onSelect: () => setDeleting(task),
          },
        ]
      : []),
  ];
  const columns: ColumnDef<TaskDefinition>[] = [
    {
      id: "name",
      header: labels.name,
      accessorKey: "name",
      size: 400,
      minSize: 260,
      enableHiding: false,
      sortingFn: (a, b) => collator.compare(a.original.name, b.original.name),
      cell: ({ row }) => {
        const task = row.original,
          count = task.items.filter((i) => i.kind !== "info").length,
          photos = task.items.filter((i) => i.kind === "photo").length;
        return (
          <div className="min-w-0 space-y-0.5">
            <button
              className="block max-w-full truncate text-left font-medium hover:text-brand focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onOpen(task)}
            >
              {task.name}
            </button>
            <div className="flex items-center gap-3 text-xs leading-3 text-muted-foreground">
              {count ? (
                <>
                  <Hint label="Пункты чек-листа">
                    <span
                      className="inline-flex items-center gap-1"
                      aria-label={`Пунктов чек-листа: ${count}`}
                    >
                      <ListChecks className="size-3" />
                      {count}
                    </span>
                  </Hint>
                  {photos > 0 && (
                    <Hint label="Пункты фотоотчёта">
                      <span
                        className="inline-flex items-center gap-1"
                        aria-label={`Пунктов фотоотчёта: ${photos}`}
                      >
                        <Camera className="size-3" />
                        {photos}
                      </span>
                    </Hint>
                  )}
                </>
              ) : (
                <span>Чек-лист не настроен</span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      id: "assignee",
      header: labels.assignee,
      accessorFn: assignee,
      size: 220,
      minSize: 150,
      cell: ({ row }) => (
        <span
          className={cn(
            "block truncate",
            !row.original.template_id && "text-muted-foreground",
          )}
        >
          {assignee(row.original)}
        </span>
      ),
    },
    {
      id: "recurrence",
      header: labels.recurrence,
      accessorFn: recurrence,
      size: 190,
      minSize: 150,
      cell: ({ row }) => (
        <span className="block truncate text-muted-foreground">
          {recurrence(row.original)}
        </span>
      ),
    },
    {
      id: "review",
      header: labels.review,
      accessorFn: (t) => t.review_mode === "manager",
      size: 110,
      minSize: 100,
      cell: ({ row }) => (
        <Hint
          label={
            row.original.review_mode === "manager"
              ? "Требуется приёмка"
              : "Приёмка не требуется"
          }
        >
          <span className="inline-flex items-center">
            <Checkbox
              checked={row.original.review_mode === "manager"}
              disabled
              className="disabled:cursor-default disabled:opacity-100"
              aria-label={
                row.original.review_mode === "manager"
                  ? "Требуется приёмка"
                  : "Приёмка не требуется"
              }
            />
          </span>
        </Hint>
      ),
    },
    {
      id: "status",
      header: labels.status,
      accessorFn: (t) => (t.enabled ? "Включена" : "Черновик"),
      size: 140,
      minSize: 110,
      cell: ({ row }) => (
        <Badge
          variant="secondary"
          className={cn(
            "whitespace-nowrap font-medium",
            row.original.enabled &&
              "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
          )}
        >
          {row.original.enabled ? "Включена" : "Черновик"}
        </Badge>
      ),
    },
    {
      id: "actions",
      size: 44,
      minSize: 44,
      maxSize: 44,
      enableHiding: false,
      enableResizing: false,
      cell: ({ row }) => <TableRowMenu actions={actions(row.original)} />,
    },
  ];
  const table = useReactTable({
    data: rows,
    columns,
    state: {
      columnVisibility: { ...st.columnVisibility, name: true, actions: true },
      columnOrder: [...st.columnOrder, "actions"],
      columnSizing: st.columnSizing,
      sorting: st.sorting,
      pagination: st.pagination,
    },
    onSortingChange: st.setSorting,
    onPaginationChange: st.setPagination,
    onColumnSizingChange: st.setColumnSizing,
    onColumnVisibilityChange: st.setColumnVisibility,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  });
  const { tableRef, onResizeStart, columnWidths, minTableWidth } =
    useTableColumnResize(table, st.setColumnSizing);
  const firstPage = () => st.setPagination((p) => ({ ...p, pageIndex: 0 }));
  const changeSorting = (sorting: typeof st.sorting) => {
    st.setSorting(sorting);
    firstPage();
  };
  const pageCount = Math.max(
    1,
    Math.ceil(rows.length / st.pagination.pageSize),
  );
  const { pagination, setPagination } = st;
  useEffect(() => {
    if (pagination.pageIndex >= pageCount)
      setPagination((p) => ({ ...p, pageIndex: pageCount - 1 }));
  }, [pageCount, pagination.pageIndex, setPagination]);
  const reset = () => {
    setShift("");
    setStatus("");
    st.setSearch("");
    st.setSorting([]);
    firstPage();
  };
  return (
    <div className="space-y-4">
      <TablePageHeader
        className="md:flex-wrap md:items-center [&>div:last-child]:max-w-full"
        title={
          <span className="inline-flex items-center gap-3">
            Задачи
            <span
              className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-muted px-2 text-sm font-normal tabular-nums text-muted-foreground"
              aria-label={`Всего: ${rows.length}`}
            >
              {rows.length}
            </span>
          </span>
        }
        actions={
          <TableControls
            search={{
              value: st.search,
              onChange: (v) => {
                st.setSearch(v);
                firstPage();
              },
              open: st.searchOpen,
              onOpenChange: st.setSearchOpen,
              placeholder: "Название задачи или шаблон смены",
            }}
            filters={{
              active: filtersVisible || active,
              onClick: () => setFiltersVisible((v) => !v),
            }}
            sort={{
              active: !!st.sorting.length,
              content: (
                <TableSortPicker
                  sorting={st.sorting}
                  onChange={changeSorting}
                  fields={[...sortable]}
                  labels={labels}
                />
              ),
            }}
            columns={{
              content: (
                <TableColumnManager
                  columns={st.columnOrder.map((id) => {
                    const c = table.getColumn(id)!;
                    return {
                      id,
                      label: labels[id],
                      visible: c.getIsVisible(),
                      canHide: c.getCanHide(),
                    };
                  })}
                  onVisibilityChange={(id, v) =>
                    table.getColumn(id)?.toggleVisibility(v)
                  }
                  onMoveColumn={(a, b) =>
                    st.setColumnOrder((order) =>
                      arrayMove(order, order.indexOf(a), order.indexOf(b)),
                    )
                  }
                  onReset={st.resetColumns}
                />
              ),
            }}
            secondaryActions={
              onSettings ? (
                <TableIconButton label="Настройки задач" onClick={onSettings}>
                  <Settings className="size-4" />
                </TableIconButton>
              ) : null
            }
            primaryActions={
              onCreate ? (
                <Button size="sm" className="h-9 gap-2" onClick={onCreate}>
                  <Plus className="size-4" />
                  Новая задача
                </Button>
              ) : null
            }
          />
        }
      />
      {(filtersVisible || active || q) && (
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label="Условия списка задач"
        >
          {(filtersVisible || shift) && (
            <TableFilterChip
              label="Шаблон смены"
              value={shift}
              onChange={(v) => {
                setShift(v);
                firstPage();
              }}
              options={[
                { value: "", label: "Все смены" },
                ...data.templates.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          )}
          {(filtersVisible || status) && (
            <TableFilterChip
              label="Статус"
              value={status}
              onChange={(v) => {
                setStatus(v);
                firstPage();
              }}
              options={[
                { value: "", label: "Все задачи" },
                { value: "enabled", label: "Включённые" },
                { value: "draft", label: "Черновики" },
              ]}
            />
          )}
          {q && (
            <span className="inline-flex h-8 max-w-64 items-center gap-2 rounded-full border border-brand/20 bg-brand/10 pl-3 pr-2 text-sm text-brand">
              <span className="truncate">Поиск: «{st.search}»</span>
              <button
                aria-label="Сбросить поиск"
                onClick={() => {
                  st.setSearch("");
                  firstPage();
                }}
              >
                <X className="size-3.5" />
              </button>
            </span>
          )}
          {(active || q) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={reset}
            >
              Очистить все
            </Button>
          )}
        </div>
      )}
      {!rows.length ? (
        <EmptyState
          icon={q || active ? SearchX : ListChecks}
          title={q || active ? "Задачи не найдены" : "Шаблонов задач пока нет"}
          description={
            q || active
              ? "Измените условия поиска или сбросьте фильтры."
              : "Создайте задачу, добавьте инструкцию и чек-лист, затем настройте повторение."
          }
          action={
            q || active ? (
              <Button variant="outline" onClick={reset}>
                Сбросить поиск и фильтры
              </Button>
            ) : onCreate ? (
              <Button onClick={onCreate}>
                <Plus className="mr-2 size-4" />
                Новая задача
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <div className={styles.scroll}>
            <table
              ref={tableRef}
              className={styles.table}
              style={{ minWidth: minTableWidth }}
              aria-label="Задачи"
            >
              <ResizableTableHead
                table={table}
                columnWidths={columnWidths}
                onResizeStart={onResizeStart}
                isControlColumn={(id) => id === "actions"}
                sortableColumnIds={sortable}
                onSort={(id) => {
                  const current = st.sorting.find((s) => s.id === id);
                  changeSorting(
                    !current
                      ? [...st.sorting, { id, desc: false }]
                      : !current.desc
                        ? st.sorting.map((s) =>
                            s.id === id ? { ...s, desc: true } : s,
                          )
                        : st.sorting.filter((s) => s.id !== id),
                  );
                }}
                headerAriaSort={(id) => {
                  if (!sortable.has(id)) return undefined;
                  const s = st.sorting.find((s) => s.id === id);
                  return s ? (s.desc ? "descending" : "ascending") : "none";
                }}
                headerIndicator={(id) => {
                  const i = st.sorting.findIndex((s) => s.id === id);
                  return i < 0 ? null : (
                    <span className="inline-flex items-center gap-0.5">
                      {st.sorting[i].desc ? (
                        <ArrowDown className="size-3" />
                      ) : (
                        <ArrowUp className="size-3" />
                      )}
                      {st.sorting.length > 1 && (
                        <span className="text-[10px]">{i + 1}</span>
                      )}
                    </span>
                  );
                }}
              />
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer"
                    onClick={(event) => {
                      if (
                        !(event.target as HTMLElement).closest(
                          "button,a,input,[role=checkbox]",
                        )
                      )
                        onOpen(row.original);
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        onClick={
                          cell.column.id === "actions"
                            ? (event) => event.stopPropagation()
                            : undefined
                        }
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PeopleMobileCards
            table={table}
            label="Карточки задач"
            nameColumn="name"
            photoColumn="__none"
            roleColumn="assignee"
            statusColumn="status"
            labels={labels}
            onOpen={(row) => onOpen(row.original)}
            empty={null}
          />
          <TablePagination
            pageIndex={Math.min(st.pagination.pageIndex, pageCount - 1)}
            pageSize={st.pagination.pageSize}
            total={rows.length}
            onPageChange={(pageIndex) =>
              st.setPagination((p) => ({ ...p, pageIndex }))
            }
            onPageSizeChange={(pageSize) =>
              st.setPagination({ pageSize, pageIndex: 0 })
            }
          />
        </>
      )}
      <DeleteTaskDialog
        task={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={onRefresh}
      />
    </div>
  );
}
