"use client";

import { useMemo, useState } from "react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeftRight,
  ArrowUpDown,
  ArrowUp,
  Calendar,
  CheckCircle2,
  Eye,
  FileDown,
  MessageSquare,
  Pencil,
  Plus,
  Repeat2,
  Trash2,
  UserPlus,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  TableBulkBar,
  TableColumnManager,
  TableControlPin,
  TableControls,
  TablePageHeader,
  TablePagination,
  TableRowMenu,
  TableSplitButton,
  useTableState,
  type ManagedTableColumn,
  type TableStateColumn,
} from "@/components/shared/table";

import { ViewPresetsDemo } from "./view-presets-demo";

type Scenario = "normal" | "loading" | "empty" | "error";
type DemoMode = "staff" | "inventory" | "document" | "finance" | "view-presets";

type LabBaseRow = {
  id: string;
  searchText: string;
  filterValue: string;
  sortValues: Record<string, string | number | null>;
};

type LabColumn<T extends LabBaseRow> = {
  id: string;
  label: string;
  size: number;
  minSize?: number;
  defaultVisible?: boolean;
  canHide?: boolean;
  cell: (row: T) => React.ReactNode;
  headerClassName?: string;
  cellClassName?: string;
};

type FilterOption = {
  value: string;
  label: string;
};

type StaffRow = LabBaseRow & {
  name: string;
  meta: string;
  initials: string;
  role: string;
  imported: boolean;
  employmentDate: string;
};

type InventoryRow = LabBaseRow & {
  product: string;
  meta: string;
  fact: string;
  diff: number;
  sum: number;
  status: "include" | "exclude" | "resort";
  comment: string | null;
};

type FinanceRow = LabBaseRow & {
  title: string;
  meta: string;
  amount: number;
  account: string;
  category: string;
  date: string;
};

type DocumentItem = {
  id: string;
  name: string;
  meta: string;
  group: string;
  value: string;
};

const scenarioOptions: Array<{ value: Scenario; label: string }> = [
  { value: "normal", label: "Обычные данные" },
  { value: "loading", label: "Загрузка" },
  { value: "empty", label: "Пусто" },
  { value: "error", label: "Ошибка импорта/экспорта" },
];

const staffRows: StaffRow[] = [
  ["1", "Тест Владелец", "owner@test.com · Владелец", "Т", "Владелец", false, "10.01.2023"],
  ["2", "Тест Управляющий", "manager@test.com · Управляющий", "Т", "Управляющий", true, "01.06.2023"],
  ["3", "Иван Официантов", "waiter@test.com · Официант", "И", "Официант", false, "15.03.2024"],
  ["4", "Мария Барная", "bar@test.com · Бармен", "М", "Бармен", true, "20.05.2024"],
  ["5", "Анна Хостес", "hostess@test.com · Хостес", "А", "Хостес", false, "04.02.2025"],
  ["6", "Павел Складской", "store@test.com · Кладовщик", "П", "Кладовщик", true, "18.08.2025"],
].map(([id, name, meta, initials, role, imported, employmentDate]) => ({
  id: String(id),
  name: String(name),
  meta: String(meta),
  initials: String(initials),
  role: String(role),
  imported: Boolean(imported),
  employmentDate: String(employmentDate),
  filterValue: String(role),
  searchText: `${name} ${meta} ${role}`.toLowerCase(),
  sortValues: { name: String(name), role: String(role), imported: imported ? 1 : 0, employmentDate: String(employmentDate) },
}));

const inventoryRows: InventoryRow[] = [
  ["1", "Coca-Cola", "2643 · шт · Безалкогольные напитки", "0,0 шт", -248, -20552.2, "include", null],
  ["2", "Coca-Cola / Zero", "2639 · шт · Безалкогольные напитки", "100,0 шт", -84, 0, "exclude", "Не списываем тестовый остаток"],
  ["3", "Энергетик / Red Bull", "2634 · шт · Безалкогольные напитки", "100,0 шт", -233, -24945.4, "include", null],
  ["4", "Энергетик / Red Bull / Sugar Free", "2641 · шт · Безалкогольные напитки", "100,0 шт", 10, 1067.9, "resort", "Зачтено на Red Bull"],
  ["5", "Тоник / Evervess / Indian / (л)", "9 · л · Безалкогольные напитки", "100,0 л", 83.2, 8338.3, "include", null],
  ["6", "Лимонад / GAMARJOBA / Сливки / 0,45", "3021 · л · Безалкогольные напитки", "0,0 л", -16.3, -3701.4, "include", "Проверить списания бара"],
  ["7", "Вода / Maruha / Газ / 0,5", "11111 · шт · Безалкогольные напитки", "0,0 шт", 3, 230.4, "include", null],
  ["8", "Вода / Maruha / Без газа / 0,5", "11110 · шт · Безалкогольные напитки", "0,0 шт", 3, 230.4, "include", null],
  ["9", "Тоник / Evervess / Indian / Стекло / 0,25", "11322 · шт · Безалкогольные напитки", "0,0 шт", -9, -639.4, "include", null],
].map(([id, product, meta, fact, diff, sum, status, comment]) => ({
  id: String(id),
  product: String(product),
  meta: String(meta),
  fact: String(fact),
  diff: Number(diff),
  sum: Number(sum),
  status: status as InventoryRow["status"],
  comment: comment ? String(comment) : null,
  filterValue: status === "exclude" ? "Не учитывать" : status === "resort" ? "Пересорт" : "Учитывать",
  searchText: `${product} ${meta} ${comment ?? ""}`.toLowerCase(),
  sortValues: { product: String(product), diff: Number(diff), sum: Number(sum), status: String(status) },
}));

const financeRows: FinanceRow[] = Array.from({ length: 34 }, (_, index) => {
  const incoming = index % 3 === 0;
  const amount = incoming ? 12500 + index * 370 : -(3200 + index * 180);
  const category = incoming ? "Выручка" : index % 2 === 0 ? "Закупки" : "Аренда";
  return {
    id: `finance-${index + 1}`,
    title: incoming ? `Поступление ${index + 1}` : `Расход ${index + 1}`,
    meta: `${index % 2 === 0 ? "Касса" : "Счет"} · ${category}`,
    amount,
    account: index % 2 === 0 ? "Касса CHILLING" : "Сбербанк",
    category,
    date: `${String((index % 28) + 1).padStart(2, "0")}.05.2026`,
    filterValue: category,
    searchText: `операция ${index + 1} ${category}`.toLowerCase(),
    sortValues: { title: `Операция ${index + 1}`, amount, category, date: index },
  };
});

const documentItems: DocumentItem[] = Array.from({ length: 48 }, (_, index) => {
  const groups = ["Безалкогольные напитки", "Посуда", "Табак / Премиум", "Зелень"];
  const group = groups[index % groups.length];
  return {
    id: `doc-${index + 1}`,
    name: [
      "Coca-Cola / Zero",
      "Энергетик / Red Bull",
      "Тоник / Evervess / Indian / Стекло / 0,25",
      "Щавель",
      "Bonche",
    ][index % 5],
    meta: `${2600 + index} · ${index % 3 === 0 ? "л" : "шт"} · ${group}`,
    group,
    value: index % 7 === 0 ? "" : String(index % 4 === 0 ? 0 : 100 + index),
  };
});

export function TableLabClient() {
  const [mode, setMode] = useState<DemoMode>("staff");

  return (
    <div className="w-full space-y-6 px-4 py-4 md:px-8 md:py-6">
      <TablePageHeader
        title="Table Lab"
        subtitle="Экспериментальная песочница таблиц: здесь утверждаем controls, bulk actions, row menu, resize, reorder и mobile-list формат."
        meta={
          <>
            <Badge variant="secondary">TanStack Table</Badge>
            <Badge variant="secondary">shadcn/Radix</Badge>
            <Badge variant="secondary">dnd-kit</Badge>
            <Badge variant="outline">localStorage preferences</Badge>
          </>
        }
      />

      <Tabs value={mode} onValueChange={(value) => setMode(value as DemoMode)}>
        <TabsList>
          <TabsTrigger value="staff">Сотрудники</TabsTrigger>
          <TabsTrigger value="inventory">Итоги инвентаризации</TabsTrigger>
          <TabsTrigger value="document">Мобильный акт</TabsTrigger>
          <TabsTrigger value="finance">Финансы</TabsTrigger>
          <TabsTrigger value="view-presets">Пресеты видов</TabsTrigger>
        </TabsList>
        <TabsContent value="staff" className="mt-5">
          <StaffDemo />
        </TabsContent>
        <TabsContent value="inventory" className="mt-5">
          <InventoryDemo />
        </TabsContent>
        <TabsContent value="document" className="mt-5">
          <DocumentDemo />
        </TabsContent>
        <TabsContent value="finance" className="mt-5">
          <FinanceDemo />
        </TabsContent>
        <TabsContent value="view-presets" className="mt-5">
          <ViewPresetsDemo />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StaffDemo() {
  const columns = useMemo<LabColumn<StaffRow>[]>(() => [
    {
      id: "name",
      label: "Имя",
      size: 360,
      canHide: false,
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {row.initials}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">{row.name}</div>
            <div className="truncate text-xs text-muted-foreground">{row.meta}</div>
          </div>
        </div>
      ),
    },
    {
      id: "role",
      label: "Должность",
      size: 160,
      cell: (row) => <Badge variant="secondary">{row.role}</Badge>,
    },
    {
      id: "imported",
      label: "Импорт из QR",
      size: 130,
      cell: (row) => (row.imported ? "Да" : "Нет"),
    },
    {
      id: "employmentDate",
      label: "Трудоустройство",
      size: 170,
      cell: (row) => (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          {row.employmentDate}
        </span>
      ),
    },
    {
      id: "actions",
      label: "",
      size: 56,
      canHide: false,
      cell: () => (
        <TableRowMenu
          actions={[
            { label: "Открыть", icon: <Eye className="h-4 w-4" />, onSelect: () => toast.info("Открываем карточку") },
            { label: "Редактировать", icon: <Pencil className="h-4 w-4" />, onSelect: () => toast.info("Редактирование") },
            { label: "Удалить", icon: <Trash2 className="h-4 w-4" />, destructive: true, separatorBefore: true, onSelect: () => toast.error("Удаление") },
          ]}
        />
      ),
    },
  ], []);

  return (
    <LabDataTable
      tableId="lab.staff"
      title="Сотрудники"
      subtitle="3 сотрудника · демо показывает метатекст, бейджи, row menu и меню колонок."
      data={staffRows}
      columns={columns}
      filters={[{ value: "all", label: "Все должности" }, ...roleOptions(staffRows)]}
      primaryAction={<Button size="sm"><UserPlus className="mr-2 h-4 w-4" />Пригласить</Button>}
    />
  );
}

function InventoryDemo() {
  const columns = useMemo<LabColumn<InventoryRow>[]>(() => [
    {
      id: "product",
      label: "Позиция",
      size: 420,
      canHide: false,
      cell: (row) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{row.product}</div>
          <div className="truncate text-xs text-muted-foreground">{row.meta}</div>
        </div>
      ),
    },
    { id: "fact", label: "Факт", size: 120, cell: (row) => row.fact },
    {
      id: "diff",
      label: "Разница",
      size: 130,
      cell: (row) => <span className={row.diff < 0 ? "text-red-700" : "text-green-700"}>{row.diff > 0 ? "+" : ""}{row.diff}</span>,
    },
    {
      id: "sum",
      label: "Упр. сумма",
      size: 150,
      cell: (row) => (
        <span className={row.sum < 0 ? "text-red-700" : row.sum > 0 ? "text-green-700" : "text-muted-foreground"}>
          {row.sum.toLocaleString("ru-RU")} ₽
        </span>
      ),
    },
    {
      id: "status",
      label: "Статус",
      size: 170,
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      id: "comment",
      label: "Комментарий",
      size: 260,
      defaultVisible: true,
      cell: (row) =>
        row.comment ? (
          <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
            <MessageSquare className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{row.comment}</span>
          </span>
        ) : "—",
    },
    {
      id: "actions",
      label: "",
      size: 56,
      canHide: false,
      cell: () => (
        <TableRowMenu
          actions={[
            { label: "Комментировать", icon: <MessageSquare className="h-4 w-4" />, onSelect: () => toast.info("Комментарий") },
            { label: "Не учитывать", icon: <XCircle className="h-4 w-4" />, onSelect: () => toast.info("Не учитывать") },
            { label: "Пересорт", icon: <Repeat2 className="h-4 w-4" />, onSelect: () => toast.info("Пересорт") },
          ]}
        />
      ),
    },
  ], []);

  return (
    <LabDataTable
      tableId="lab.inventory-results"
      title="Итоги инвентаризации"
      subtitle="Массовый выбор, bulk bar, статусы, комментарии, пересорт и исключения."
      data={inventoryRows}
      columns={columns}
      filters={[
        { value: "all", label: "Все статусы" },
        { value: "Учитывать", label: "Учитывать" },
        { value: "Не учитывать", label: "Не учитывать" },
        { value: "Пересорт", label: "Пересорт" },
      ]}
      bulkActions={
        <>
          <Button size="sm"><Repeat2 className="mr-2 h-4 w-4" />Пересорт</Button>
          <Button size="sm" variant="outline">Не учитывать</Button>
        </>
      }
    />
  );
}

function FinanceDemo() {
  const columns = useMemo<LabColumn<FinanceRow>[]>(() => [
    {
      id: "title",
      label: "Операция",
      size: 360,
      canHide: false,
      cell: (row) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{row.title}</div>
          <div className="truncate text-xs text-muted-foreground">{row.meta}</div>
        </div>
      ),
    },
    {
      id: "amount",
      label: "Сумма",
      size: 160,
      cell: (row) => (
        <span className={row.amount < 0 ? "text-red-700" : "text-green-700"}>
          {row.amount.toLocaleString("ru-RU")} ₽
        </span>
      ),
    },
    { id: "account", label: "Счет", size: 180, cell: (row) => row.account },
    { id: "category", label: "Категория", size: 160, cell: (row) => <Badge variant="outline">{row.category}</Badge> },
    { id: "date", label: "Дата", size: 140, cell: (row) => row.date },
    {
      id: "actions",
      label: "",
      size: 56,
      canHide: false,
      cell: () => (
        <TableRowMenu
          actions={[
            { label: "Открыть", icon: <Eye className="h-4 w-4" />, onSelect: () => toast.info("Открыть") },
            { label: "Экспорт строки", icon: <FileDown className="h-4 w-4" />, onSelect: () => toast.info("Экспорт") },
          ]}
        />
      ),
    },
  ], []);

  return (
    <LabDataTable
      tableId="lab.finance"
      title="Финансы"
      subtitle="Много строк, импорт/экспорт, суммы, категории и сохранение размера колонок."
      data={financeRows}
      columns={columns}
      filters={[{ value: "all", label: "Все категории" }, ...categoryOptions(financeRows)]}
      controlsVariant="pins"
      primaryAction={
        <TableSplitButton
          label="Создать"
          icon={<Plus className="h-4 w-4" />}
          primaryTooltip="Создать операцию"
          menuTooltip="Выбрать тип операции"
          onPrimaryClick={() => toast.info("Создаем операцию")}
          options={[
            { label: "Приход", icon: <Plus className="h-4 w-4" />, onSelect: () => toast.info("Приход") },
            { label: "Расход", icon: <ArrowDown className="h-4 w-4" />, onSelect: () => toast.info("Расход") },
            { label: "Перевод", icon: <ArrowLeftRight className="h-4 w-4" />, onSelect: () => toast.info("Перевод") },
          ]}
        />
      }
    />
  );
}

function LabDataTable<T extends LabBaseRow>({
  tableId,
  title,
  subtitle,
  data,
  columns,
  filters,
  primaryAction,
  bulkActions,
  controlsVariant = "default",
}: {
  tableId: string;
  title: string;
  subtitle: string;
  data: T[];
  columns: LabColumn<T>[];
  filters: FilterOption[];
  primaryAction?: React.ReactNode;
  bulkActions?: React.ReactNode;
  controlsVariant?: "default" | "pins";
}) {
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [filter, setFilter] = useState("all");
  const stateColumns: TableStateColumn[] = useMemo(
    () => columns.map((column) => ({
      id: column.id,
      defaultVisible: column.defaultVisible,
      defaultSize: column.size,
    })),
    [columns],
  );
  const tableState = useTableState({ tableId, columns: stateColumns });

  const filteredData = useMemo(() => {
    if (scenario === "empty") return [];
    const query = tableState.search.trim().toLowerCase();
    return data.filter((row) => {
      if (filter !== "all" && row.filterValue !== filter) return false;
      if (!query) return true;
      return row.searchText.includes(query);
    });
  }, [data, filter, scenario, tableState.search]);

  const tableColumns = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((column) => ({
        id: column.id,
        accessorFn: (row) => row.sortValues[column.id] ?? row.searchText,
        header: column.label,
        size: column.size,
        minSize: column.minSize ?? 72,
        enableHiding: column.canHide !== false,
        cell: ({ row }) => column.cell(row.original),
      })),
    [columns],
  );

  const table = useReactTable({
    data: filteredData,
    columns: tableColumns,
    state: {
      sorting: tableState.sorting,
      rowSelection: tableState.rowSelection,
      columnVisibility: tableState.columnVisibility,
      columnOrder: tableState.columnOrder,
      columnSizing: tableState.columnSizing,
      pagination: tableState.pagination,
    },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    columnResizeMode: "onChange",
    onSortingChange: tableState.setSorting,
    onRowSelectionChange: tableState.setRowSelection,
    onColumnVisibilityChange: tableState.setColumnVisibility,
    onColumnOrderChange: tableState.setColumnOrder,
    onColumnSizingChange: tableState.setColumnSizing,
    onPaginationChange: tableState.setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const selectedCount = table.getSelectedRowModel().rows.length;
  const visibleRows = table.getPaginationRowModel().rows;
  const hiddenCount = data.length - filteredData.length;
  const shownFrom = filteredData.length === 0 ? 0 : tableState.pagination.pageIndex * tableState.pagination.pageSize + 1;
  const shownTo = Math.min(filteredData.length, (tableState.pagination.pageIndex + 1) * tableState.pagination.pageSize);
  const managedColumns = tableState.columnOrder
    .map((columnId) => table.getAllLeafColumns().find((column) => column.id === columnId))
    .filter((column): column is NonNullable<typeof column> => Boolean(column))
    .map((column): ManagedTableColumn => ({
      id: column.id,
      label: String(column.columnDef.header ?? column.id) || "Действия",
      visible: column.getIsVisible(),
      canHide: column.getCanHide(),
      width: column.getSize(),
    }));

  const moveColumn = (activeId: string, overId: string) => {
    tableState.setColumnOrder((current) => {
      const oldIndex = current.indexOf(activeId);
      const newIndex = current.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) return current;
      return arrayMove(current, oldIndex, newIndex);
    });
  };

  const scenarioHasError = scenario === "error";
  const usePinControls = controlsVariant === "pins";
  const [filterPinsVisible, setFilterPinsVisible] = useState(usePinControls);
  const sortableColumns = columns.filter((column) => column.id !== "actions");
  const cycleColumnSorting = (columnId: string) => {
    tableState.setSorting((current) => {
      const index = current.findIndex((sort) => sort.id === columnId);
      if (index < 0) return [...current, { id: columnId, desc: false }];

      const currentSort = current[index];
      if (!currentSort.desc) {
        return current.map((sort, sortIndex) => (
          sortIndex === index ? { ...sort, desc: true } : sort
        ));
      }

      return current.filter((_, sortIndex) => sortIndex !== index);
    });
  };

  return (
    <div className="space-y-4">
      <TablePageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <TableControls
            search={{
              value: tableState.search,
              onChange: (value) => {
                tableState.setSearch(value);
                table.setPageIndex(0);
              },
              open: tableState.searchOpen,
              onOpenChange: tableState.setSearchOpen,
              placeholder: "Поиск по таблице",
            }}
            filters={{
              active: filterPinsVisible || filter !== "all" || scenario !== "normal",
              label: filterPinsVisible ? "Скрыть фильтры" : "Показать фильтры",
              onClick: usePinControls ? () => setFilterPinsVisible((current) => !current) : undefined,
              content: usePinControls ? undefined : (
                <FiltersPanel
                  scenario={scenario}
                  onScenarioChange={setScenario}
                  filter={filter}
                  onFilterChange={(value) => {
                    setFilter(value);
                    table.setPageIndex(0);
                  }}
                  filters={filters}
                />
              ),
            }}
            sort={{
              active: tableState.sorting.length > 0,
              content: (
                usePinControls ? (
                  <SortFieldPanel
                    columns={sortableColumns}
                    sorting={tableState.sorting}
                    onSortingChange={tableState.setSorting}
                  />
                ) : (
                  <SortPanel
                    columns={sortableColumns}
                    sorting={tableState.sorting}
                    onSortingChange={tableState.setSorting}
                  />
                )
              ),
            }}
            columns={{
              active: managedColumns.some((column) => !column.visible),
              content: (
                <TableColumnManager
                  columns={managedColumns}
                  onVisibilityChange={(columnId, visible) =>
                    tableState.setColumnVisibility((current) => ({ ...current, [columnId]: visible }))
                  }
                  onMoveColumn={moveColumn}
                  onReset={tableState.resetColumns}
                />
              ),
            }}
            importAction={{
              label: "Импорт",
              onClick: () => scenarioHasError ? toast.error("Ошибка импорта: неверный формат файла") : toast.success("Импорт запущен"),
              disabled: scenario === "loading",
            }}
            exportAction={{
              label: "Экспорт",
              onClick: () => scenarioHasError ? toast.error("Ошибка экспорта: нет доступа") : toast.success("Экспорт готов"),
              disabled: scenario === "loading" || filteredData.length === 0,
            }}
            primaryActions={primaryAction}
            summary={
              <>
                Показано {shownFrom}-{shownTo} из {filteredData.length}
                {hiddenCount > 0 ? <span> · скрыто: {hiddenCount}</span> : null}
              </>
            }
          />
        }
      />

      {usePinControls ? (
        <ActiveTablePins
          columns={sortableColumns}
          sorting={tableState.sorting}
          onSortingChange={tableState.setSorting}
          search={tableState.search}
          onSearchChange={(value) => {
            tableState.setSearch(value);
            table.setPageIndex(0);
          }}
          scenario={scenario}
          onScenarioChange={setScenario}
          filter={filter}
          onFilterChange={(value) => {
            setFilter(value);
            table.setPageIndex(0);
          }}
          filters={filters}
          showFilters={filterPinsVisible}
          onResetAll={() => {
            tableState.setSearch("");
            tableState.setSorting([]);
            setFilter("all");
            setScenario("normal");
            table.setPageIndex(0);
          }}
        />
      ) : null}

      {scenarioHasError ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4" />
          Демонстрация error-state для импорта/экспорта. Таблица остается рабочей.
        </div>
      ) : null}

      <div className="relative overflow-hidden rounded-lg border bg-background">
        <div className="overflow-x-auto">
          <table className="w-full min-w-full table-fixed" style={{ minWidth: table.getTotalSize() + 40 }}>
            <colgroup>
              <col style={{ width: 40 }} />
              {table.getVisibleLeafColumns().map((column) => (
                <col key={column.id} style={{ width: column.id === "actions" ? 56 : column.getSize() }} />
              ))}
            </colgroup>
            <thead className="group/header bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="h-11">
                    <th className="w-10 border-b px-3 py-3 text-left">
                      <Checkbox
                        checked={table.getIsAllPageRowsSelected()}
                        onCheckedChange={(checked) => table.toggleAllPageRowsSelected(Boolean(checked))}
                        aria-label="Выбрать все строки страницы"
                      />
                    </th>
                    {headerGroup.headers.map((header) => {
                      const isActionsColumn = header.column.id === "actions";

                      return (
                        <th
                          key={header.id}
                          className={cn(
                            "relative border-b px-3 py-3",
                            isActionsColumn ? "w-14 max-w-14 text-right" : "text-left",
                          )}
                          style={{ width: isActionsColumn ? 56 : header.getSize() }}
                        >
                          {isActionsColumn ? null : (
                            <button
                              type="button"
                              className="flex max-w-full items-center gap-1 truncate"
                              onClick={() => cycleColumnSorting(header.column.id)}
                            >
                              <span className="truncate">
                                {flexRender(header.column.columnDef.header, header.getContext())}
                              </span>
                              {header.column.getIsSorted() === "asc" ? "↑" : header.column.getIsSorted() === "desc" ? "↓" : null}
                            </button>
                          )}
                          {header.column.getCanResize() ? (
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
            <tbody>
              {scenario === "loading" ? (
                <LoadingRows colSpan={table.getVisibleLeafColumns().length + 1} />
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={table.getVisibleLeafColumns().length + 1} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    Данных по текущим условиям нет.
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b last:border-b-0 hover:bg-muted/30",
                      row.getIsSelected() ? "bg-brand/5 hover:bg-brand/10" : null,
                    )}
                  >
                    <td className="px-3 py-3">
                      <Checkbox
                        checked={row.getIsSelected()}
                        onCheckedChange={(checked) => row.toggleSelected(Boolean(checked))}
                        aria-label="Выбрать строку"
                      />
                    </td>
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={cn("px-3 py-3 text-sm", cell.column.id === "actions" ? "w-14 max-w-14 text-right" : null)}
                        style={{ width: cell.column.id === "actions" ? 56 : cell.column.getSize() }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <TablePagination
        pageIndex={tableState.pagination.pageIndex}
        pageSize={tableState.pagination.pageSize}
        total={filteredData.length}
        hiddenCount={hiddenCount}
        onPageChange={(pageIndex) => table.setPageIndex(pageIndex)}
        onPageSizeChange={(pageSize) => table.setPageSize(pageSize)}
      />

      <TableBulkBar
        floating
        selectedCount={selectedCount > 1 ? selectedCount : 0}
        onClear={() => table.resetRowSelection()}
        actions={bulkActions ?? (
          <>
            <Button size="sm" variant="outline">Экспорт выбранных</Button>
            <Button size="sm" variant="outline">Архивировать</Button>
          </>
        )}
      />
    </div>
  );
}

function DocumentDemo() {
  const stateColumns = useMemo<TableStateColumn[]>(
    () => [
      { id: "product", defaultSize: 320 },
      { id: "group", defaultSize: 180 },
      { id: "value", defaultSize: 120 },
    ],
    [],
  );
  const tableState = useTableState({
    tableId: "lab.document-list",
    columns: stateColumns,
  });
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [group, setGroup] = useState("all");
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(documentItems.map((item) => [item.id, item.value])),
  );

  const filteredItems = useMemo(() => {
    if (scenario === "empty") return [];
    const search = tableState.search.trim().toLowerCase();
    return documentItems.filter((item) => {
      if (group !== "all" && item.group !== group) return false;
      if (!search) return true;
      return `${item.name} ${item.meta}`.toLowerCase().includes(search);
    });
  }, [group, scenario, tableState.search]);

  const pageStart = tableState.pagination.pageIndex * tableState.pagination.pageSize;
  const visibleItems = filteredItems.slice(pageStart, pageStart + tableState.pagination.pageSize);
  const groups = Array.from(new Set(documentItems.map((item) => item.group)));
  const hiddenCount = documentItems.length - filteredItems.length;

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4">
      <TablePageHeader
        title="Акт № CB300"
        subtitle="Карточный/mobile-list формат. Controls и pagination те же, что у таблицы."
        actions={
          <TableControls
            search={{
              value: tableState.search,
              onChange: tableState.setSearch,
              open: tableState.searchOpen,
              onOpenChange: tableState.setSearchOpen,
              placeholder: "Поиск по позиции",
            }}
            filters={{
              active: group !== "all" || scenario !== "normal",
              content: (
                <div className="space-y-4">
                  <PopoverTitle>Фильтры</PopoverTitle>
                  <label className="block space-y-1.5 text-sm">
                    <span className="font-medium">Состояние</span>
                    <Select value={scenario} onValueChange={(value) => setScenario(value as Scenario)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {scenarioOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="block space-y-1.5 text-sm">
                    <span className="font-medium">Группа</span>
                    <Select value={group} onValueChange={setGroup}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Все группы</SelectItem>
                        {groups.map((itemGroup) => (
                          <SelectItem key={itemGroup} value={itemGroup}>{itemGroup}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                </div>
              ),
            }}
            importAction={{ label: "Импорт", onClick: () => toast.info("Импорт строк") }}
            exportAction={{ label: "Экспорт", onClick: () => toast.info("Экспорт черновика") }}
            primaryActions={<Button size="sm">Отправить</Button>}
            summary={
              <>
                Показано {filteredItems.length === 0 ? 0 : pageStart + 1}-{Math.min(filteredItems.length, pageStart + tableState.pagination.pageSize)} из {filteredItems.length}
                {hiddenCount > 0 ? <span> · скрыто: {hiddenCount}</span> : null}
              </>
            }
          />
        }
      />

      <div className="hidden overflow-hidden rounded-lg border bg-background md:block">
        <table className="w-full table-fixed">
          <thead className="bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-20 border-b px-3 py-3 text-left">Фото</th>
              <th className="border-b px-3 py-3 text-left">Позиция</th>
              <th className="w-64 border-b px-3 py-3 text-left">Группа</th>
              <th className="w-40 border-b px-3 py-3 text-right">Факт</th>
            </tr>
          </thead>
          <tbody>
            {scenario === "loading" ? (
              <LoadingRows colSpan={4} />
            ) : visibleItems.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  Позиций нет.
                </td>
              </tr>
            ) : (
              visibleItems.map((item) => (
                <tr key={item.id} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-3 py-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted text-[10px] text-muted-foreground">
                      нет фото
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{item.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{item.meta}</div>
                    </div>
                  </td>
                  <td className="truncate px-3 py-3 text-sm text-muted-foreground">{item.group}</td>
                  <td className="px-3 py-3">
                    <Input
                      inputMode="decimal"
                      value={values[item.id] ?? ""}
                      onChange={(event) => setValues((current) => ({ ...current, [item.id]: event.target.value }))}
                      className="ml-auto h-9 max-w-32 text-right"
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="grid gap-2 md:hidden">
        {scenario === "loading" ? (
          Array.from({ length: 6 }, (_, index) => <div key={index} className="h-20 animate-pulse rounded-lg border bg-muted/50" />)
        ) : visibleItems.length === 0 ? (
          <div className="rounded-lg border bg-background px-4 py-12 text-center text-sm text-muted-foreground">Позиций нет.</div>
        ) : (
          visibleItems.map((item) => (
            <div key={item.id} className="grid grid-cols-[48px_1fr_96px] items-center gap-3 rounded-lg border bg-background p-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-md border bg-muted text-[10px] text-muted-foreground">нет фото</div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{item.name}</div>
                <div className="truncate text-xs text-muted-foreground">{item.meta}</div>
              </div>
              <Input
                inputMode="decimal"
                value={values[item.id] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [item.id]: event.target.value }))}
                className="h-9 text-right"
              />
            </div>
          ))
        )}
      </div>

      <TablePagination
        pageIndex={tableState.pagination.pageIndex}
        pageSize={tableState.pagination.pageSize}
        total={filteredItems.length}
        hiddenCount={hiddenCount}
        onPageChange={(pageIndex) => tableState.setPagination((current) => ({ ...current, pageIndex }))}
        onPageSizeChange={(pageSize) => tableState.setPagination({ pageIndex: 0, pageSize })}
      />
    </div>
  );
}

function FiltersPanel({
  scenario,
  onScenarioChange,
  filter,
  onFilterChange,
  filters,
}: {
  scenario: Scenario;
  onScenarioChange: (scenario: Scenario) => void;
  filter: string;
  onFilterChange: (filter: string) => void;
  filters: FilterOption[];
}) {
  return (
    <div className="space-y-4">
      <PopoverTitle>Фильтры</PopoverTitle>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Состояние</span>
        <Select value={scenario} onValueChange={(value) => onScenarioChange(value as Scenario)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {scenarioOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Фильтр данных</span>
        <Select value={filter} onValueChange={onFilterChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {filters.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}

function SortFieldPanel<T extends LabBaseRow>({
  columns,
  sorting,
  onSortingChange,
}: {
  columns: LabColumn<T>[];
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
}) {
  const sortedIds = new Set(sorting.map((sort) => sort.id));

  return (
    <div className="space-y-3">
      <PopoverTitle>Сортировка</PopoverTitle>
      <div className="space-y-1">
        {columns.map((column) => (
          <button
            key={column.id}
            type="button"
            onClick={() => {
              if (sortedIds.has(column.id)) return;
              onSortingChange([...sorting, { id: column.id, desc: false }]);
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent",
              sortedIds.has(column.id) ? "bg-accent text-muted-foreground" : null,
            )}
          >
            <span>{column.label}</span>
            {sortedIds.has(column.id) ? <span className="text-xs">Добавлено</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function ActiveTablePins<T extends LabBaseRow>({
  columns,
  sorting,
  onSortingChange,
  search,
  onSearchChange,
  scenario,
  onScenarioChange,
  filter,
  onFilterChange,
  filters,
  showFilters,
  onResetAll,
}: {
  columns: LabColumn<T>[];
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  search: string;
  onSearchChange: (search: string) => void;
  scenario: Scenario;
  onScenarioChange: (scenario: Scenario) => void;
  filter: string;
  onFilterChange: (filter: string) => void;
  filters: FilterOption[];
  showFilters: boolean;
  onResetAll: () => void;
}) {
  const activeFilter = filters.find((option) => option.value === filter);
  const activeScenario = scenarioOptions.find((option) => option.value === scenario);
  const activeSort = sorting[0];
  const activeSortColumn = activeSort ? columns.find((column) => column.id === activeSort.id) : null;
  const hasActiveControls = sorting.length > 0 || filter !== "all" || scenario !== "normal" || search.trim().length > 0;
  const showSortBlock = sorting.length > 0;
  const showFilterBlock = showFilters;
  const showSearchPin = search.trim().length > 0 && (showFilters || showSortBlock || filter !== "all" || scenario !== "normal");

  if (!showFilters && !showSortBlock && filter === "all" && scenario === "normal") return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showSortBlock ? (
        <TableControlPin
          active
          icon={
            sorting.length === 1
              ? activeSort?.desc
                ? <ArrowDown />
                : <ArrowUp />
              : <ArrowUpDown />
          }
          label={sorting.length === 1 ? activeSortColumn?.label ?? activeSort?.id ?? "Сортировка" : `${sorting.length} сортировки`}
          contentClassName="w-auto p-3"
        >
          <SortPinEditor
            columns={columns}
            sorting={sorting}
            onSortingChange={onSortingChange}
          />
        </TableControlPin>
      ) : null}

      {showSortBlock && (showFilterBlock || showSearchPin) ? <PinDivider /> : null}

      {showFilterBlock ? (
        <TableControlPin
          active={filter !== "all"}
          label={activeFilter?.label ?? "Все категории"}
          onClear={() => onFilterChange("all")}
          clearLabel="Сбросить фильтр"
        >
          <PinOptionList
            options={filters}
            value={filter}
            onChange={onFilterChange}
          />
        </TableControlPin>
      ) : null}

      {showFilterBlock ? (
        <TableControlPin
          active={scenario !== "normal"}
          label={activeScenario?.label ?? "Состояние"}
          onClear={() => onScenarioChange("normal")}
          clearLabel="Сбросить состояние"
        >
          <PinOptionList
            options={scenarioOptions}
            value={scenario}
            onChange={(value) => onScenarioChange(value as Scenario)}
          />
        </TableControlPin>
      ) : null}

      {showFilterBlock && showSearchPin ? <PinDivider /> : null}

      {showSearchPin ? (
        <TableControlPin
          active
          label={`Поиск: ${search.trim()}`}
          onClear={() => onSearchChange("")}
          clearLabel="Очистить поиск"
        >
          <div className="space-y-2 p-2">
            <Input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Поиск по таблице"
              className="h-8"
            />
          </div>
        </TableControlPin>
      ) : null}

      {hasActiveControls ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onResetAll}
        >
          Очистить все
        </Button>
      ) : null}
    </div>
  );
}

function PinDivider() {
  return <div className="mx-1 h-6 w-px bg-border" aria-hidden="true" />;
}

function PinOptionList({
  options,
  value,
  onChange,
}: {
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent",
            option.value === value ? "bg-accent" : null,
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SortPinEditor<T extends LabBaseRow>({
  columns,
  sorting,
  onSortingChange,
}: {
  columns: LabColumn<T>[];
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
}) {
  const [showAddSort, setShowAddSort] = useState(false);
  const unusedColumns = columns.filter((column) => !sorting.some((item) => item.id === column.id));
  const updateSort = (index: number, next: SortingState[number]) => {
    onSortingChange(sorting.map((item, itemIndex) => (itemIndex === index ? next : item)));
  };
  const replaceSortColumn = (index: number, columnId: string) => {
    const existingIndex = sorting.findIndex((item) => item.id === columnId);
    if (existingIndex >= 0 && existingIndex !== index) return;
    updateSort(index, { ...sorting[index], id: columnId });
  };

  return (
    <div className="w-[min(420px,calc(100vw-3rem))] space-y-3">
      <PopoverTitle>Сортировка</PopoverTitle>
      <div className="space-y-2">
        {sorting.map((sort, index) => (
          <div key={`${sort.id}-${index}`} className="grid grid-cols-[1fr_132px_32px] items-center gap-2">
            <Select value={sort.id} onValueChange={(value) => replaceSortColumn(index, value)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {columns.map((column) => {
                  const disabled = sorting.some((item, itemIndex) => itemIndex !== index && item.id === column.id);
                  return (
                    <SelectItem key={column.id} value={column.id} disabled={disabled}>
                      {column.label}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Select
              value={sort.desc ? "desc" : "asc"}
              onValueChange={(value) => updateSort(index, { ...sort, desc: value === "desc" })}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="asc">По возрастанию</SelectItem>
                <SelectItem value="desc">По убыванию</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => onSortingChange(sorting.filter((_, itemIndex) => itemIndex !== index))}
              aria-label="Удалить сортировку"
            >
              <XCircle className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      {showAddSort && unusedColumns.length > 0 ? (
        <div className="rounded-lg border bg-background p-2">
          {unusedColumns.map((column) => (
            <button
              key={column.id}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                onSortingChange([...sorting, { id: column.id, desc: false }]);
                setShowAddSort(false);
              }}
            >
              <ArrowUp className="h-4 w-4 text-muted-foreground" />
              {column.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="space-y-1 border-t pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
          disabled={unusedColumns.length === 0}
          onClick={() => setShowAddSort((current) => !current)}
        >
          <Plus className="h-4 w-4" />
          Добавить сортировку
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive"
          onClick={() => onSortingChange([])}
        >
          <Trash2 className="h-4 w-4" />
          Удалить сортировку
        </Button>
      </div>
    </div>
  );
}

function SortPanel<T extends LabBaseRow>({
  columns,
  sorting,
  onSortingChange,
}: {
  columns: LabColumn<T>[];
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
}) {
  return (
    <div className="space-y-3">
      <PopoverTitle>Сортировка</PopoverTitle>
      <div className="space-y-1">
        {columns.map((column) => (
          <div key={column.id} className="grid grid-cols-2 gap-1">
            <Button type="button" variant="ghost" size="sm" className="justify-start" onClick={() => onSortingChange([{ id: column.id, desc: false }])}>
              {column.label} ↑
            </Button>
            <Button type="button" variant="ghost" size="sm" className="justify-start" onClick={() => onSortingChange([{ id: column.id, desc: true }])}>
              {column.label} ↓
            </Button>
          </div>
        ))}
      </div>
      {sorting.length > 0 ? (
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => onSortingChange([])}>
          Сбросить сортировку
        </Button>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: InventoryRow["status"] }) {
  if (status === "exclude") {
    return <span className="inline-flex items-center gap-1 text-sm"><XCircle className="h-4 w-4 text-red-600" />Не учитывать</span>;
  }
  if (status === "resort") {
    return <span className="inline-flex items-center gap-1 text-sm"><Repeat2 className="h-4 w-4 text-blue-600" />Пересорт</span>;
  }
  return <span className="inline-flex items-center gap-1 text-sm"><CheckCircle2 className="h-4 w-4 text-green-700" />Учитывать</span>;
}

function LoadingRows({ colSpan }: { colSpan: number }) {
  return (
    <>
      {Array.from({ length: 6 }, (_, index) => (
        <tr key={index}>
          <td colSpan={colSpan} className="px-3 py-3">
            <div className="h-9 animate-pulse rounded-md bg-muted" />
          </td>
        </tr>
      ))}
    </>
  );
}

function PopoverTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function roleOptions(rows: StaffRow[]) {
  return Array.from(new Set(rows.map((row) => row.role)))
    .sort((left, right) => left.localeCompare(right, "ru"))
    .map((role) => ({ value: role, label: role }));
}

function categoryOptions(rows: FinanceRow[]) {
  return Array.from(new Set(rows.map((row) => row.category)))
    .sort((left, right) => left.localeCompare(right, "ru"))
    .map((category) => ({ value: category, label: category }));
}
