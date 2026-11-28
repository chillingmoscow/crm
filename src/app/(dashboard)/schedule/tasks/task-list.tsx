"use client";
import { useEffect, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import {
  ListChecks,
  Pencil,
  Plus,
  Repeat,
  SearchX,
  Trash2,
  UserCheck,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { taskMissing, taskStatus, taskStatusTone } from "./task-status";
import { EmptyState } from "@/components/ui/empty-state";
import {
  ROW_MENU_COLUMN_SIZE,
  TableColumnManager,
  TableControls,
  TablePageHeader,
  TablePagination,
  TableRowMenu,
  DataTable,
  TableConditions,
  TableFilterChip,
  TableSortPicker,
  useTableState,
} from "@/components/shared/table";
import type { TaskData, TaskDefinition } from "@/lib/schedule/tasks";
import { ColorDot } from "@/components/ui/color-dot";
import { DrawerStatus } from "@/components/ui/drawer-blocks";
import { taskRecurrenceLabel } from "@/lib/schedule/task-recurrence";
import { DeleteTaskDialog } from "./delete-task-dialog";

const definitions = [
  { id: "name", label: "Задача", size: 400, min: 260 },
  { id: "assignee", label: "Шаблон смены", size: 220, min: 150 },
  { id: "recurrence", label: "Повторение", size: 240, min: 170 },
  { id: "review", label: "Проверка", size: 150, min: 120 },
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
export function TaskList({
  data,
  onOpen,
  onCreate,
  onRefresh,
  notice,
}: {
  data: TaskData;
  onOpen: (task: TaskDefinition) => void;
  onCreate?: () => void;
  onRefresh: () => Promise<unknown>;
  /** Предупреждение под шапкой списка (сбои отправки в Telegram). */
  notice?: React.ReactNode;
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
  const recurrence = (t: TaskDefinition) => taskRecurrenceLabel(t.recurrence) ?? "Не настроено";
  const missing = taskMissing;
  const statusOf = taskStatus;
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
      // Только название: счётчики пунктов и фото — шум; чего не хватает —
      // в статусе «Не настроена».
      // Настоящая кнопка в первой ячейке: строку можно открыть с клавиатуры.
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => onOpen(row.original)}
          className="block max-w-full truncate text-left font-medium transition-colors duration-200 hover:text-brand"
          data-tip={row.original.name}
        >
          {row.original.name}
        </button>
      ),
    },
    {
      id: "assignee",
      header: labels.assignee,
      accessorFn: assignee,
      size: 220,
      minSize: 150,
      cell: ({ row }) => {
        const template = data.templates.find((x) => x.id === row.original.template_id);
        return template ? (
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px]">
            <ColorDot color={template.color} size="md" />
            <span className="truncate">{template.name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Не назначена</span>
        );
      },
    },
    {
      id: "recurrence",
      header: labels.recurrence,
      accessorFn: recurrence,
      size: 190,
      minSize: 150,
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          {row.original.recurrence && <Repeat className="size-3.5 shrink-0" />}
          <span className="truncate">{recurrence(row.original)}</span>
        </span>
      ),
    },
    {
      id: "review",
      header: labels.review,
      accessorFn: (t) => t.review_mode === "manager",
      size: 110,
      minSize: 100,
      // Словами вместо «серой галочки», которая выглядела как переключатель.
      cell: ({ row }) =>
        row.original.review_mode === "manager" ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <UserCheck className="size-3.5" />
            Управляющий
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Zap className="size-3.5" />
            Автоматически
          </span>
        ),
    },
    {
      id: "status",
      header: labels.status,
      accessorFn: statusOf,
      size: 140,
      minSize: 110,
      cell: ({ row }) => {
        const status = statusOf(row.original);
        return (
          <span
            data-tip={status === "Не настроена" ? `Не хватает: ${missing(row.original).join(", ")}` : undefined}
            className="inline-flex"
          >
            <DrawerStatus
              label={status}
              tone={taskStatusTone(status)}
            />
          </span>
        );
      },
    },
    {
      id: "actions",
      size: ROW_MENU_COLUMN_SIZE,
      minSize: ROW_MENU_COLUMN_SIZE,
      maxSize: ROW_MENU_COLUMN_SIZE,
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
        title="Задачи"
        count={rows.length}
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
              active,
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
      {notice}
      <TableConditions
        label="Условия списка задач"
        open={filtersVisible}
        hasFilters={active}
        sorting={st.sorting}
        onSortingChange={changeSorting}
        sortFields={[...sortable]}
        sortLabels={labels}
        search={st.search}
        onSearchClear={() => {
          st.setSearch("");
          firstPage();
        }}
        onReset={reset}
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
      </TableConditions>
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
          <DataTable
            table={table}
            label="Задачи"
            labels={labels}
            onColumnSizingChange={st.setColumnSizing}
            sorting={st.sorting}
            onSortingChange={changeSorting}
            sortable={sortable}
            onRowClick={(row) => onOpen(row.original)}
            empty={null}
            mobile={{
              label: "Карточки задач",
              nameColumn: "name",
              roleColumn: "assignee",
              statusColumn: "status",
            }}
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
