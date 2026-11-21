"use client";

import { useEffect, useMemo, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  FolderTree,
  ListFilter,
  Pencil,
  SearchX,
  Tags,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { DirectoryPeriodPicker } from "@/components/finance/period-picker";
import {
  parsePeriod,
  periodParam,
  periodPhrase,
  transactionsHref as transactionsHrefFor,
  type DirectoryPeriod,
} from "@/lib/finance/period";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { HardDeleteConfirmDialog } from "@/components/shared/hard-delete-confirm-dialog";
import { Money } from "@/components/shared/money";
import { PageFrame } from "@/components/shared/page-frame";
import {
  DataTable,
  ROW_MENU_COLUMN_SIZE,
  TableColumnManager,
  TableConditions,
  TableControls,
  TableFilterChip,
  TableIconButton,
  TablePageHeader,
  TableRowMenu,
  TableSortPicker,
  useTableState,
  type TableRowMenuAction,
} from "@/components/shared/table";
import { CategoryColorDot } from "@/components/finance/category-color";
import {
  CATEGORY_TYPE_LABEL,
  CategoryDrawer,
  type CategoryDrawerCategory,
} from "@/components/finance/category-drawer";
import {
  archiveFinanceCategory,
  createFinanceCategoryGroup,
  deleteFinanceCategory,
  deleteFinanceCategoryGroup,
  restoreFinanceCategory,
  updateFinanceCategoryGroup,
} from "@/lib/finance/categories";
import { formatDateCell } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import { cn } from "@/lib/utils";
import { GroupsDrawer } from "../../_components/groups-drawer";
import {
  countCategories,
  countVisibleCategories,
  flattenCategories,
  type CategoryTreeRow,
  type CategoryType,
  type TreeCategory,
  type TreeGroup,
} from "./category-tree";

type ColKey = "name" | "type" | "operations" | "lastDate" | "total";

const labels: Record<ColKey, string> = {
  name: "Статья",
  type: "Тип",
  operations: "Операций",
  lastDate: "Последняя операция",
  total: "Сумма",
};
const activityColumns: ColKey[] = ["operations", "lastDate", "total"];
const columnConfig = [
  { id: "name", defaultSize: 420 },
  { id: "type", defaultSize: 130 },
  { id: "operations", defaultSize: 120 },
  { id: "lastDate", defaultSize: 180 },
  { id: "total", defaultSize: 160 },
  { id: "actions", defaultSize: ROW_MENU_COLUMN_SIZE },
];

const GROUP_KIND_OPTIONS = [
  { value: "mixed", label: "Любых" },
  { value: "expense", label: "Расходов" },
  { value: "income", label: "Доходов" },
];
const GROUP_KIND_TEXT: Record<string, string> = {
  mixed: "любые статьи",
  expense: "статьи расходов",
  income: "статьи доходов",
};

/** Отступ уровня дерева и место под стрелку (кнопка 24 + отступ 12). */
const INDENT = 24;
const CHEVRON_SLOT = 36;
const UNDO_WINDOW_MS = 15_000;

/** Отступ уровня — только в таблице: на телефоне строки становятся карточками. */
function treePad(px: number): CSSProperties {
  return { "--tree-pad": `${px}px` } as CSSProperties;
}


/** Итоги группы: число операций, последняя дата и сумма, если статьи одного типа. */
function groupTotals(items: TreeCategory[]) {
  if (items.some((item) => item.operations === null)) return null;
  const operations = items.reduce((sum, item) => sum + (item.operations ?? 0), 0);
  const lastDate = items.reduce<string | null>(
    (latest, item) => (item.lastDate && (!latest || item.lastDate > latest) ? item.lastDate : latest),
    null,
  );
  const sameType = items.every((item) => item.type === items[0]?.type);
  const total = sameType ? items.reduce((sum, item) => sum + (item.total ?? 0), 0) : null;
  return { operations, lastDate, total };
}

export function CategoriesClient({
  groups,
  categories,
  canManage,
  isOwner,
  canDelete,
  canViewTransactions,
  hasActivity,
  initialArchive,
  openCreate,
  period: periodValue,
  today,
}: {
  groups: TreeGroup[];
  categories: TreeCategory[];
  canManage: boolean;
  /** Архив, возврат и удаление — только владелец аккаунта. */
  isOwner: boolean;
  canDelete: boolean;
  canViewTransactions: boolean;
  /** Активность посчитана; `false` при праве на операции — сбой подсчёта. */
  hasActivity: boolean;
  initialArchive: boolean;
  openCreate: boolean;
  /** Период столбцов активности из адреса (`?period=`); null — всё время. */
  period: string | null;
  /** Сегодня (`ГГГГ-ММ-ДД`) с сервера: край листания периода. */
  today: string;
}) {
  const router = useRouter();
  const period = useMemo(() => parsePeriod(periodValue), [periodValue]);
  const [periodPending, startPeriod] = useTransition();
  const periodUrl = (next: DirectoryPeriod) => {
    const param = periodParam(next);
    return param ? `/finance/categories?period=${param}` : "/finance/categories";
  };
  const changePeriod = (next: DirectoryPeriod) =>
    startPeriod(() => router.push(periodUrl(next), { scroll: false }));
  const transactionsHref = (categoryId: string) => transactionsHrefFor({ category_id: categoryId }, period);
  const phrase = periodPhrase(period);
  const st = useTableState({ tableId: "finance.categories", columns: columnConfig });

  const [showArchive, setShowArchive] = useState(initialArchive);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"" | CategoryType>("");
  const [groupFilter, setGroupFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const view = {
    collapsed,
    search: st.search,
    archived: showArchive,
    type: typeFilter,
    group: groupFilter,
    sorting: st.sorting,
  };
  const rows = useMemo(
    () => flattenCategories(groups, categories, view),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, categories, collapsed, st.search, showArchive, typeFilter, groupFilter, st.sorting],
  );
  const total = countCategories(categories, showArchive);
  const archivedCount = countCategories(categories, true);
  const narrowed = Boolean(st.search.trim()) || typeFilter !== "" || groupFilter !== "";
  const visible = narrowed ? countVisibleCategories(groups, categories, view) : total;
  const hasFilters = typeFilter !== "" || groupFilter !== "";

  const toggleGroup = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const resetConditions = () => {
    setTypeFilter("");
    setGroupFilter("");
    st.setSearch("");
    st.setSorting([]);
  };

  // ── Панель статьи ──────────────────────────────────────────

  // ?create=1 открывает панель один раз: после этого убираем его из адреса,
  // чтобы обновление страницы не открывало её снова.
  useEffect(() => {
    if (openCreate) router.replace(periodUrl(period), { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [drawer, setDrawer] = useState<{ id: string | null; createType: CategoryType } | null>(
    openCreate ? { id: null, createType: "expense" } : null,
  );
  const openCategory = drawer?.id ? categories.find((category) => category.id === drawer.id) ?? null : null;
  const drawerCategory: CategoryDrawerCategory | null = openCategory
    ? {
        id: openCategory.id,
        name: openCategory.name,
        type: openCategory.type,
        groupId: openCategory.groupId,
        description: openCategory.description,
        color: openCategory.color,
        isSystem: openCategory.isSystem,
        isPayroll: openCategory.isPayroll,
        archivedAt: openCategory.archivedAt,
        operations: openCategory.operations,
        lastDate: openCategory.lastDate,
        total: openCategory.total,
      }
    : null;

  // ── Архив, возврат, удаление ───────────────────────────────

  const [archiveTarget, setArchiveTarget] = useState<TreeCategory | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TreeCategory | null>(null);

  const restore = async (category: Pick<TreeCategory, "id" | "name">) => {
    setRestoringId(category.id);
    const result = await restoreFinanceCategory(category.id).catch(() => ({
      error: "Не удалось вернуть статью. Проверьте соединение и повторите",
    }));
    setRestoringId(null);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`Статья «${category.name}» возвращена из архива`);
    router.refresh();
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    const category = archiveTarget;
    setArchiveBusy(true);
    setArchiveError(null);
    const result = await archiveFinanceCategory(category.id, { confirmName: category.name }).catch(() => ({
      error: "Не удалось отправить статью в архив. Проверьте соединение и повторите",
    }));
    setArchiveBusy(false);
    if (result.error) {
      setArchiveError(result.error);
      return;
    }
    setArchiveTarget(null);
    if (drawer?.id === category.id) setDrawer(null);
    toast(`Статья «${category.name}» в архиве`, {
      duration: UNDO_WINDOW_MS,
      action: { label: "Отменить", onClick: () => void restore(category) },
    });
    router.refresh();
  };

  const menuActions = (category: TreeCategory, inDrawer = false): TableRowMenuAction[] => {
    const actions: TableRowMenuAction[] = [];
    if (!inDrawer && canManage && !category.archived) {
      actions.push({ label: "Изменить", icon: <Pencil />, onSelect: () => setDrawer({ id: category.id, createType: category.type }) });
    }
    if (!inDrawer && canViewTransactions) {
      actions.push({
        label: "Операции по статье",
        icon: <ListFilter />,
        onSelect: () => router.push(transactionsHref(category.id)),
      });
    }
    if (isOwner && !category.archived && !category.archiveBlocked) {
      actions.push({
        label: "В архив",
        icon: <Archive />,
        separatorBefore: actions.length > 0,
        onSelect: () => {
          setArchiveError(null);
          setArchiveTarget(category);
        },
      });
    }
    if (isOwner && category.archived) {
      if (!inDrawer) {
        actions.push({
          label: "Вернуть из архива",
          icon: <ArchiveRestore />,
          separatorBefore: actions.length > 0,
          onSelect: () => void restore(category),
        });
      }
      if (canDelete && !category.isPayroll) {
        actions.push({
          label: "Удалить навсегда",
          icon: <Trash2 />,
          destructive: true,
          separatorBefore: actions.length > 0,
          onSelect: () => setDeleteTarget(category),
        });
      }
    }
    return actions;
  };
  const hasMenu = canManage || canViewTransactions || isOwner;

  // ── Группы ─────────────────────────────────────────────────

  const [groupsOpen, setGroupsOpen] = useState(false);
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const category of categories) {
      if (category.groupId) counts.set(category.groupId, (counts.get(category.groupId) ?? 0) + 1);
    }
    return counts;
  }, [categories]);
  const afterGroupChange = (result: { error: string | null }) => {
    if (!result.error) router.refresh();
    return result;
  };

  // ── Таблица ────────────────────────────────────────────────

  const showActivity = canViewTransactions;
  const sortFields: ColKey[] = showActivity ? ["name", "type", "operations", "lastDate", "total"] : ["name", "type"];
  // Место под стрелку у статей без группы держим, только если в списке есть группы.
  const hasGroupRows = rows.some((row) => row.type === "group");

  const nameCell = (item: CategoryTreeRow) => {
    if (item.type === "group") {
      const { group } = item;
      return (
        <span className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              toggleGroup(group.id);
            }}
            aria-expanded={item.expanded}
            aria-label={`${item.expanded ? "Свернуть" : "Раскрыть"} группу «${group.name}»`}
            className="touch-target flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            <ChevronRight className={cn("size-4 transition-transform", item.expanded && "rotate-90")} />
          </button>
          <span className="min-w-0">
            <span className="block truncate font-medium" data-tip={group.name}>
              {group.name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {countRu(item.count, "статья", "статьи", "статей")}
              {group.isPayroll ? " · статьи должностей" : ""}
            </span>
          </span>
        </span>
      );
    }
    const category = item.category;
    const marker = category.archivedAt
      ? `В архиве с ${formatDateCell(category.archivedAt)}`
      : category.isPayroll
        ? "ФОТ должности"
        : category.isSystem
          ? "Системная"
          : null;
    const second = [marker, category.description?.trim() || null].filter(Boolean).join(" · ");
    return (
      <span
        className="flex min-w-0 items-center gap-3 sm:pl-[var(--tree-pad)]"
        style={treePad(item.depth * INDENT + (hasGroupRows ? CHEVRON_SLOT : 0))}
      >
        <span className="flex size-3 shrink-0 items-center justify-center">
          <CategoryColorDot color={category.color} />
        </span>
        <span className="min-w-0">
          {/* Настоящая кнопка в первой ячейке: статью можно открыть с клавиатуры. */}
          <button
            type="button"
            className="block max-w-full truncate text-left font-medium hover:underline"
            data-tip={category.name}
            onClick={(event) => {
              event.stopPropagation();
              setDrawer({ id: category.id, createType: category.type });
            }}
          >
            {category.name}
          </button>
          {second ? (
            <span className="block truncate text-xs text-muted-foreground" data-tip={second}>
              {second}
            </span>
          ) : null}
        </span>
      </span>
    );
  };

  const columns: ColumnDef<CategoryTreeRow>[] = [
    {
      id: "name",
      header: labels.name,
      size: 420,
      minSize: 220,
      enableHiding: false,
      cell: ({ row }) => nameCell(row.original),
    },
    {
      id: "type",
      header: labels.type,
      size: 130,
      minSize: 90,
      cell: ({ row }) => {
        const item = row.original;
        if (item.type === "group") {
          const kinds = new Set(item.items.map((category) => category.type));
          return kinds.size === 1 ? (
            <span className="text-muted-foreground">{CATEGORY_TYPE_LABEL[[...kinds][0]]}</span>
          ) : null;
        }
        return <span>{CATEGORY_TYPE_LABEL[item.category.type]}</span>;
      },
    },
    ...(showActivity
      ? ([
          {
            id: "operations",
            header: labels.operations,
            size: 120,
            minSize: 104,
            cell: ({ row }) => {
              const item = row.original;
              const value = item.type === "group" ? groupTotals(item.items)?.operations ?? null : item.category.operations;
              if (value === null) return <span className="text-muted-foreground">—</span>;
              return (
                <span className={cn("tabular-nums", (value === 0 || item.type === "group") && "text-muted-foreground")}>
                  {value}
                </span>
              );
            },
          },
          {
            id: "lastDate",
            header: labels.lastDate,
            size: 180,
            minSize: 170,
            cell: ({ row }) => {
              const item = row.original;
              const value = item.type === "group" ? groupTotals(item.items)?.lastDate ?? null : item.category.lastDate;
              if (!value) return <span className="text-muted-foreground">—</span>;
              return (
                <span className={cn("tabular-nums", item.type === "group" && "text-muted-foreground")}>
                  {formatDateCell(value)}
                </span>
              );
            },
          },
          {
            id: "total",
            header: labels.total,
            size: 160,
            minSize: 110,
            cell: ({ row }) => {
              const item = row.original;
              if (item.type === "group") {
                const totals = groupTotals(item.items);
                return totals?.total ? <Money value={totals.total} className="text-muted-foreground" /> : null;
              }
              const { category } = item;
              if (category.total === null || category.operations === 0) {
                return <span className="text-muted-foreground">—</span>;
              }
              return canViewTransactions ? (
                <Link
                  href={transactionsHref(category.id)}
                  className="hover:underline"
                  data-tip={`${category.type === "income" ? "Получено" : "Потрачено"} ${phrase}`}
                  data-tip-sub="Открыть операции по статье"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Money value={category.total} />
                </Link>
              ) : (
                <Money value={category.total} />
              );
            },
          },
        ] satisfies ColumnDef<CategoryTreeRow>[])
      : []),
    ...(hasMenu
      ? [
          {
            id: "actions",
            size: ROW_MENU_COLUMN_SIZE,
            minSize: ROW_MENU_COLUMN_SIZE,
            maxSize: ROW_MENU_COLUMN_SIZE,
            enableHiding: false,
            enableResizing: false,
            enableSorting: false,
            cell: ({ row }) => {
              const item = row.original;
              if (item.type === "group") return null;
              const menu = menuActions(item.category);
              return menu.length > 0 ? <TableRowMenu label={`Действия со статьёй «${item.category.name}»`} actions={menu} /> : null;
            },
          } satisfies ColumnDef<CategoryTreeRow>,
        ]
      : []),
  ];

  const table = useReactTable({
    data: rows,
    columns,
    state: {
      sorting: st.sorting,
      columnVisibility: {
        ...st.columnVisibility,
        name: true,
        actions: hasMenu,
        ...(showActivity ? {} : { operations: false, lastDate: false, total: false }),
      },
      columnOrder: st.columnOrder,
      columnSizing: st.columnSizing,
    },
    // Порядок строк задаёт дерево (сортировка внутри группы), не TanStack.
    manualSorting: true,
    onColumnVisibilityChange: st.setColumnVisibility,
    onColumnSizingChange: st.setColumnSizing,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
  });
  const changeSorting = (next: SortingState) => st.setSorting(next);

  // Итоги — когда выбран тип: сумма доходов с расходами смысла не имеет.
  const visibleCategories = rows.flatMap((row) =>
    row.type === "category" ? [row.category] : row.expanded ? [] : row.items,
  );
  const totals =
    showActivity && hasActivity && typeFilter
      ? {
          name: <span className="font-medium">Итого</span>,
          operations: (
            <span className="tabular-nums">
              {visibleCategories.reduce((sum, category) => sum + (category.operations ?? 0), 0)}
            </span>
          ),
          total: <Money value={visibleCategories.reduce((sum, category) => sum + (category.total ?? 0), 0)} />,
        }
      : undefined;

  const groupFilterOptions = [
    { value: "", label: "Все группы" },
    ...[...groups]
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map((group) => ({ value: group.id, label: group.name })),
    { value: "none", label: "Без группы" },
  ];

  const toggleArchive = () => setShowArchive((value) => !value);

  let body: React.ReactNode;
  if (total === 0 && showArchive) {
    body = (
      <EmptyState
        icon={Archive}
        title="Архив пуст"
        description="Сюда попадают статьи, которые больше не нужны. Операции по ним сохраняют статью"
        action={
          <Button variant="outline" onClick={toggleArchive}>
            К действующим статьям
          </Button>
        }
      />
    );
  } else if (total === 0) {
    body = (
      <EmptyState
        icon={Tags}
        title="Статей пока нет"
        description={
          canManage
            ? "Статьи делят операции на доходы и расходы по смыслу: аренда, закупка продуктов, выручка"
            : "Статьи добавляет сотрудник с правом управлять статьями"
        }
      />
    );
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon={SearchX}
        title="Статьи не найдены"
        description="Измените условия поиска или сбросьте фильтры"
        action={
          <Button variant="outline" onClick={resetConditions}>
            Очистить все
          </Button>
        }
      />
    );
  } else {
    body = (
      <DataTable
        table={table}
        label={showArchive ? "Статьи в архиве" : "Статьи"}
        labels={labels}
        onColumnSizingChange={st.setColumnSizing}
        sorting={st.sorting}
        onSortingChange={changeSorting}
        sortable={sortFields}
        numeric={["operations", "total"]}
        onRowClick={(row) => {
          const item = row.original;
          if (item.type === "group") toggleGroup(item.group.id);
          else setDrawer({ id: item.category.id, createType: item.category.type });
        }}
        rowClassName={(row) => (row.original.type === "group" ? "bg-muted/30" : undefined)}
        totals={totals}
        empty={null}
        mobile={{ label: "Карточки статей", nameColumn: "name" }}
      />
    );
  }

  return (
    <PageFrame className="flex min-w-0 flex-col gap-4">
      <Breadcrumbs items={[{ label: "Финансы" }, { label: "Статьи" }]} />
      <TablePageHeader
        // Заголовок в архиве тот же: режим виден по нажатой кнопке архива.
        title="Статьи"
        count={narrowed ? `${visible} из ${total}` : total}
        period={
          showActivity ? (
            <DirectoryPeriodPicker
              value={period}
              today={today}
              onChange={changePeriod}
              ariaLabel="Период операций по статьям"
            />
          ) : undefined
        }
        actions={
          <TableControls
            search={{
              value: st.search,
              onChange: st.setSearch,
              open: st.searchOpen,
              onOpenChange: st.setSearchOpen,
              placeholder: "Название или описание",
            }}
            filters={{ active: hasFilters, onClick: () => setFiltersOpen((value) => !value) }}
            sort={{
              active: st.sorting.length > 0,
              content: (
                <TableSortPicker sorting={st.sorting} onChange={changeSorting} fields={sortFields} labels={labels} />
              ),
            }}
            columns={{
              content: (
                <TableColumnManager
                  columns={st.columnOrder
                    .filter((id) => id !== "actions" && (showActivity || !activityColumns.includes(id as ColKey)))
                    .map((id) => {
                      const column = table.getColumn(id);
                      return {
                        id,
                        label: labels[id as ColKey],
                        visible: column?.getIsVisible() ?? false,
                        canHide: column?.getCanHide() ?? false,
                      };
                    })}
                  onVisibilityChange={(id, value) => table.getColumn(id)?.toggleVisibility(value)}
                  onMoveColumn={(a, b) =>
                    st.setColumnOrder((order) => arrayMove(order, order.indexOf(a), order.indexOf(b)))
                  }
                  onReset={st.resetColumns}
                />
              ),
            }}
            secondaryActions={
              <>
                {canManage ? (
                  <TableIconButton label="Группы статей" onClick={() => setGroupsOpen(true)}>
                    <FolderTree />
                  </TableIconButton>
                ) : null}
                {isOwner && (archivedCount > 0 || showArchive) ? (
                  <TableIconButton
                    label={showArchive ? "Вернуться к действующим статьям" : `Архив статей · ${archivedCount}`}
                    active={showArchive}
                    onClick={toggleArchive}
                  >
                    <Archive />
                  </TableIconButton>
                ) : null}
              </>
            }
            primaryActions={
              canManage ? (
                <Button onClick={() => setDrawer({ id: null, createType: typeFilter || "expense" })}>
                  Новая статья
                </Button>
              ) : null
            }
          />
        }
      />
      <TableConditions
        label="Условия списка статей"
        open={filtersOpen}
        hasFilters={hasFilters}
        sorting={st.sorting}
        onSortingChange={changeSorting}
        sortFields={sortFields}
        sortLabels={labels}
        search={st.search}
        onSearchClear={() => st.setSearch("")}
        onReset={resetConditions}
      >
        {(filtersOpen || typeFilter !== "") && (
          <TableFilterChip
            label="Тип"
            value={typeFilter}
            onChange={(value) => setTypeFilter(value as "" | CategoryType)}
            options={[
              { value: "", label: "Все статьи" },
              { value: "expense", label: "Расходы" },
              { value: "income", label: "Доходы" },
            ]}
          />
        )}
        {(filtersOpen || groupFilter !== "") && (
          <TableFilterChip label="Группа" value={groupFilter} onChange={setGroupFilter} options={groupFilterOptions} />
        )}
      </TableConditions>

      {showActivity && !hasActivity && total > 0 ? (
        <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          Не удалось посчитать операции по статьям: в столбцах «Операций» и «Сумма» прочерки. Обновите страницу
          позже
        </div>
      ) : null}

      {/* Пока считается новый период, старые цифры приглушены. */}
      <div aria-busy={periodPending} className={cn("min-w-0 transition-opacity", periodPending && "opacity-60")}>
        {body}
      </div>

      <CategoryDrawer
        open={drawer !== null}
        onOpenChange={(open) => {
          if (!open) setDrawer(null);
        }}
        category={drawerCategory}
        createType={drawer?.createType ?? "expense"}
        groups={groups}
        canManage={canManage}
        menu={openCategory ? menuActions(openCategory, true) : []}
        operationsHref={openCategory && canViewTransactions ? transactionsHref(openCategory.id) : null}
        periodPhrase={phrase}
        onRestore={openCategory?.archived && isOwner ? () => void restore(openCategory) : undefined}
        restoring={Boolean(openCategory && restoringId === openCategory.id)}
        onSaved={() => router.refresh()}
      />

      <GroupsDrawer
        open={groupsOpen}
        onOpenChange={setGroupsOpen}
        title="Группы статей"
        description="Группа собирает статьи в списке. Удаление группы не удаляет статьи"
        noun={["статья", "статьи", "статей"]}
        groups={[...groups]
          .sort((a, b) => a.name.localeCompare(b.name, "ru"))
          .map((group) => ({
            id: group.id,
            name: group.name,
            count: groupCounts.get(group.id) ?? 0,
            kind: group.type ?? "mixed",
            locked: group.isPayroll
              ? "В эту группу попадают статьи должностей для выплат зарплаты, удалить её нельзя"
              : undefined,
          }))}
        kindField={{
          label: "Для статей",
          options: GROUP_KIND_OPTIONS,
          defaultValue: "mixed",
          describe: (value) => GROUP_KIND_TEXT[value] ?? GROUP_KIND_TEXT.mixed,
        }}
        onCreate={async ({ name, kind }) =>
          afterGroupChange(
            await createFinanceCategoryGroup({ name, type: kind as "income" | "expense" | "mixed" }).then((r) => ({
              error: r.error,
            })),
          )
        }
        onUpdate={async (id, { name, kind }) => {
          const group = groups.find((item) => item.id === id);
          return afterGroupChange(
            await updateFinanceCategoryGroup(id, {
              name,
              ...(group?.isPayroll ? {} : { type: kind as "income" | "expense" | "mixed" }),
            }),
          );
        }}
        onDelete={async (id) => afterGroupChange(await deleteFinanceCategoryGroup(id))}
      />

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open && !archiveBusy) setArchiveTarget(null);
        }}
        title={archiveTarget ? `Отправить статью «${archiveTarget.name}» в архив?` : "Отправить статью в архив?"}
        description={
          <>
            Статья пропадёт из списка и из выбора в новых операциях. Это не удаление:
            {archiveTarget?.operations
              ? ` ${countRu(archiveTarget.operations, "операция", "операции", "операций")} сохранят статью, отчёты не изменятся.`
              : " операции и отчёты не изменятся."}{" "}
            Найти статью можно по кнопке «Архив» в ряду инструментов.
          </>
        }
        confirmLabel="В архив"
        pendingLabel="Отправляем…"
        busy={archiveBusy}
        error={archiveError}
        onConfirm={() => void confirmArchive()}
      />

      {deleteTarget ? (
        <HardDeleteConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          entityGenitive="статью"
          entityName={deleteTarget.name}
          impact={
            deleteTarget.operations
              ? [{ label: "Операции останутся без статьи", count: deleteTarget.operations, tone: "unbind" }]
              : []
          }
          restrictedBy={[]}
          onConfirm={async () => {
            const result = await deleteFinanceCategory(deleteTarget.id, { confirmName: deleteTarget.name });
            if (result.error) return { error: result.error };
            toast.success(`Статья «${deleteTarget.name}» удалена`);
            setDeleteTarget(null);
            if (drawer?.id === deleteTarget.id) setDrawer(null);
            router.refresh();
          }}
        />
      ) : null}

    </PageFrame>
  );
}
