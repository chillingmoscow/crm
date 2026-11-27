"use client";

import { useExitValue } from "@/hooks/use-exit-value";
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  FolderTree,
  ListFilter,
  Plus,
  SearchX,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  HardDeleteConfirmDialog,
  type DeleteImpact,
} from "@/components/shared/hard-delete-confirm-dialog";
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
  TablePagination,
  TableRowMenu,
  TableSortPicker,
  useTableState,
  type TableRowMenuAction,
} from "@/components/shared/table";
import { CounterpartyCreateDrawer } from "@/components/finance/counterparty-create-drawer";
import { DirectoryPeriodPicker } from "@/components/finance/period-picker";
import {
  parsePeriod,
  periodParam,
  periodPhrase,
  transactionsHref as transactionsHrefFor,
  type DirectoryPeriod,
} from "@/lib/finance/period";
import {
  archiveCounterparty,
  createCounterpartyGroup,
  deleteCounterparty,
  deleteCounterpartyGroup,
  getCounterpartyArchiveImpact,
  restoreCounterparty,
  updateCounterpartyGroup,
  type CounterpartyArchiveImpact,
} from "@/lib/finance/counterparties";
import { formatDateCell } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import { formatPhoneDisplay } from "@/lib/format/phone";
import { countRu } from "@/lib/format/plural";
import { LEGAL_FORM_LABELS } from "@/lib/org/legal-entity-labels";
import type { LegalForm } from "@/types/database";
import { GroupsDrawer } from "../../_components/groups-drawer";

export type CounterpartyListRow = {
  id: string;
  name: string;
  legalForm: LegalForm;
  inn: string | null;
  kpp: string | null;
  groupId: string | null;
  /** Первый контакт — для столбца «Контакт». */
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  /** Все контакты одной строкой (имена, роли, почта, Telegram) — для поиска. */
  contactsText: string;
  /** Телефоны всех контактов — для поиска по цифрам. */
  contactPhones: string[];
  isSupplier: boolean;
  /** Есть сертификат, который истекает в ближайшие 30 дней или просрочен. */
  certificateAlert: "expired" | "expiring" | null;
  description: string | null;
  archivedAt: string | null;
  /** Активность: `null` — данных нет (нет права на операции или сбой). */
  operations: number | null;
  lastDate: string | null;
  incomeTotal: number | null;
  expenseTotal: number | null;
};

type ColKey = "name" | "inn" | "group" | "contact" | "operations" | "lastDate" | "expense" | "income";

const labels: Record<ColKey, string> = {
  name: "Контрагент",
  inn: "ИНН",
  group: "Группа",
  contact: "Контакт",
  operations: "Операций",
  lastDate: "Последняя операция",
  expense: "Оплачено",
  income: "Получено",
};
const activityColumns: ColKey[] = ["operations", "lastDate", "expense", "income"];
const columnConfig = [
  { id: "name", defaultSize: 300 },
  { id: "inn", defaultSize: 140 },
  { id: "group", defaultSize: 170 },
  { id: "contact", defaultSize: 200 },
  { id: "operations", defaultSize: 110 },
  { id: "lastDate", defaultSize: 170 },
  { id: "expense", defaultSize: 140 },
  // Поступления от контрагентов редки (возвраты, кешбэк) — столбец включают по желанию.
  { id: "income", defaultSize: 140, defaultVisible: false },
  { id: "actions", defaultSize: ROW_MENU_COLUMN_SIZE },
];
const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });
const UNDO_WINDOW_MS = 15_000;


type Row = CounterpartyListRow & { groupName: string | null };

export function CounterpartiesClient({
  rows: initialRows,
  groups,
  canManage,
  isOwner,
  canHardDelete,
  canViewTransactions,
  hasActivity,
  dadataEnabled,
  initialArchive,
  openCreate,
  period: periodValue,
  today,
}: {
  rows: CounterpartyListRow[];
  groups: { id: string; name: string }[];
  canManage: boolean;
  /** Архив, возврат и удаление — только владелец аккаунта. */
  isOwner: boolean;
  canHardDelete: boolean;
  canViewTransactions: boolean;
  hasActivity: boolean;
  dadataEnabled: boolean;
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
  const periodQuery = periodParam(period) ? `?period=${periodParam(period)}` : "";
  const changePeriod = (next: DirectoryPeriod) => {
    const param = periodParam(next);
    startPeriod(() => router.push(`/finance/counterparties${param ? `?period=${param}` : ""}`, { scroll: false }));
  };
  // Карточка открывается с тем же периодом на вкладке «Операции».
  const cardHref = (id: string) => `/finance/counterparties/${id}${periodQuery}`;
  const transactionsHref = (id: string) => transactionsHrefFor({ counterparty_id: id }, period);
  const phrase = periodPhrase(period);
  const st = useTableState({ tableId: "finance.counterparties", columns: columnConfig });
  const firstPage = () => st.setPagination((p) => ({ ...p, pageIndex: 0 }));

  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group.name])), [groups]);
  const rows: Row[] = useMemo(
    () => initialRows.map((row) => ({ ...row, groupName: row.groupId ? groupById.get(row.groupId) ?? null : null })),
    [initialRows, groupById],
  );

  const [showArchive, setShowArchive] = useState(initialArchive);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [groupFilter, setGroupFilter] = useState("");
  const [activityFilter, setActivityFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [certificateFilter, setCertificateFilter] = useState("");

  const liveRows = useMemo(() => rows.filter((row) => !row.archivedAt), [rows]);
  const archivedRows = useMemo(() => rows.filter((row) => row.archivedAt), [rows]);
  const modeRows = showArchive ? archivedRows : liveRows;

  const q = st.search.toLocaleLowerCase("ru").trim();
  const digits = q.replace(/\D/g, "");
  const filtered = useMemo(
    () =>
      modeRows.filter((row) => {
        if (q) {
          const text = [row.name, row.contactsText, row.description].some((value) =>
            value?.toLocaleLowerCase("ru").includes(q),
          );
          // ИНН и телефон — по цифрам: «ИНН 7707…» и «+7 (999)…» тоже находятся.
          const numbers =
            digits.length >= 3 &&
            [row.inn, row.kpp, ...row.contactPhones].some((value) => value?.replace(/\D/g, "").includes(digits));
          if (!text && !numbers) return false;
        }
        if (groupFilter === "none" && row.groupId) return false;
        if (groupFilter && groupFilter !== "none" && row.groupId !== groupFilter) return false;
        if (supplierFilter === "suppliers" && !row.isSupplier) return false;
        if (supplierFilter === "others" && row.isSupplier) return false;
        if (certificateFilter === "alert" && !row.certificateAlert) return false;
        if (activityFilter === "with" && !row.operations) return false;
        if (activityFilter === "without" && row.operations) return false;
        return true;
      }),
    [modeRows, q, digits, groupFilter, supplierFilter, certificateFilter, activityFilter],
  );
  const hasFilters = Boolean(groupFilter || supplierFilter || certificateFilter || activityFilter);
  const isFiltered = q.length > 0 || hasFilters;
  const resetConditions = () => {
    setGroupFilter("");
    setSupplierFilter("");
    setCertificateFilter("");
    setActivityFilter("");
    st.setSearch("");
    st.setSorting([]);
    firstPage();
  };

  // ── Создание ───────────────────────────────────────────────

  const [createOpen, setCreateOpen] = useState(openCreate);
  // ?create=1 открывает панель один раз: убираем его из адреса.
  useEffect(() => {
    if (openCreate) router.replace(`/finance/counterparties${periodQuery}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Архив, возврат, удаление ───────────────────────────────

  const [archiveTarget, setArchiveTarget] = useState<Row | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<CounterpartyArchiveImpact | null>(null);
  // Окно держим смонтированным, пока оно закрывается (docs/motion.md): в нём
  // остаются прежние название и последствия, а не сброшенные.
  const shownDelete = useExitValue(deleteTarget && { target: deleteTarget, impact: deleteImpact });

  const restore = async (row: Pick<Row, "id" | "name">) => {
    const result = await restoreCounterparty(row.id).catch(() => ({
      error: "Не удалось вернуть контрагента. Проверьте соединение и повторите",
    }));
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`Контрагент «${row.name}» возвращён из архива`);
    router.refresh();
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    const row = archiveTarget;
    setArchiveBusy(true);
    setArchiveError(null);
    const result = await archiveCounterparty(row.id, { confirmName: row.name }).catch(() => ({
      error: "Не удалось отправить контрагента в архив. Проверьте соединение и повторите",
    }));
    setArchiveBusy(false);
    if (result.error) {
      setArchiveError(result.error);
      return;
    }
    setArchiveTarget(null);
    toast(`Контрагент «${row.name}» в архиве`, {
      duration: UNDO_WINDOW_MS,
      action: { label: "Отменить", onClick: () => void restore(row) },
    });
    router.refresh();
  };

  const openDelete = async (row: Row) => {
    setDeleteTarget(row);
    setDeleteImpact(null);
    setDeleteImpact(await getCounterpartyArchiveImpact(row.id).catch(() => null));
  };

  const menuActions = (row: Row): TableRowMenuAction[] => {
    const actions: TableRowMenuAction[] = [
      { label: "Открыть карточку", icon: <ExternalLink />, onSelect: () => router.push(cardHref(row.id)) },
    ];
    if (canViewTransactions) {
      actions.push({
        label: "Операции с контрагентом",
        icon: <ListFilter />,
        onSelect: () => router.push(transactionsHref(row.id)),
      });
    }
    if (isOwner && !row.archivedAt) {
      actions.push({
        label: "В архив",
        icon: <Archive />,
        separatorBefore: true,
        onSelect: () => {
          setArchiveError(null);
          setArchiveTarget(row);
        },
      });
    }
    if (isOwner && row.archivedAt) {
      actions.push({
        label: "Вернуть из архива",
        icon: <ArchiveRestore />,
        separatorBefore: true,
        onSelect: () => void restore(row),
      });
      if (canHardDelete) {
        actions.push({
          label: "Удалить навсегда",
          icon: <Trash2 />,
          destructive: true,
          separatorBefore: true,
          onSelect: () => void openDelete(row),
        });
      }
    }
    return actions;
  };

  // ── Группы ─────────────────────────────────────────────────

  const [groupsOpen, setGroupsOpen] = useState(false);
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) if (row.groupId) counts.set(row.groupId, (counts.get(row.groupId) ?? 0) + 1);
    return counts;
  }, [rows]);
  const afterGroupChange = (result: { error: string | null }) => {
    if (!result.error) router.refresh();
    return result;
  };

  // ── Таблица ────────────────────────────────────────────────

  const showActivity = canViewTransactions;
  const sortFields: ColKey[] = showActivity
    ? ["name", "inn", "group", "contact", "operations", "lastDate", "expense", "income"]
    : ["name", "inn", "group", "contact"];
  const empty = <span className="text-muted-foreground">—</span>;

  const columns: ColumnDef<Row>[] = [
    {
      id: "name",
      header: labels.name,
      size: 300,
      minSize: 200,
      enableHiding: false,
      accessorFn: (row) => row.name,
      sortingFn: (a, b) => collator.compare(a.original.name, b.original.name),
      cell: ({ row }) => {
        const item = row.original;
        const second = item.archivedAt
          ? `В архиве с ${formatDateCell(item.archivedAt)}`
          : [item.isSupplier ? "Поставщик" : null, LEGAL_FORM_LABELS[item.legalForm], item.description?.trim() || null]
              .filter(Boolean)
              .join(" · ");
        const alert =
          item.certificateAlert === "expired"
            ? "Сертификат просрочен"
            : item.certificateAlert === "expiring"
              ? "Сертификат истекает"
              : null;
        return (
          <div className="min-w-0">
            {/* Настоящая ссылка в первой ячейке: карточку можно открыть с клавиатуры. */}
            <Link
              href={cardHref(item.id)}
              className="block max-w-full truncate font-medium transition-colors duration-200 hover:text-brand"
              data-tip={item.name}
              onClick={(event) => event.stopPropagation()}
            >
              {item.name}
            </Link>
            {second || alert ? (
              <span className="block truncate text-xs text-muted-foreground" data-tip={[alert, second].filter(Boolean).join(" · ")}>
                {alert ? (
                  <span className={item.certificateAlert === "expired" ? "text-destructive" : "text-amber-700 dark:text-amber-400"}>
                    {alert}
                  </span>
                ) : null}
                {alert && second ? " · " : null}
                {second}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "inn",
      header: labels.inn,
      size: 140,
      minSize: 120,
      accessorFn: (row) => row.inn ?? undefined,
      sortUndefined: "last",
      cell: ({ row }) =>
        row.original.inn ? (
          <span className="block truncate tabular-nums" data-tip={row.original.kpp ? `КПП ${row.original.kpp}` : undefined}>
            {row.original.inn}
          </span>
        ) : (
          empty
        ),
    },
    {
      id: "group",
      header: labels.group,
      size: 170,
      minSize: 110,
      accessorFn: (row) => row.groupName ?? undefined,
      sortUndefined: "last",
      sortingFn: (a, b) => collator.compare(a.original.groupName ?? "", b.original.groupName ?? ""),
      cell: ({ row }) =>
        row.original.groupName ? (
          <span className="block truncate" data-tip={row.original.groupName}>
            {row.original.groupName}
          </span>
        ) : (
          empty
        ),
    },
    {
      id: "contact",
      header: labels.contact,
      size: 200,
      minSize: 120,
      accessorFn: (row) => row.contactPerson ?? row.phone ?? undefined,
      sortUndefined: "last",
      cell: ({ row }) => {
        const item = row.original;
        const phone = item.phone ? formatPhoneDisplay(item.phone) : null;
        if (!item.contactPerson && !phone && !item.email) return empty;
        const first = item.contactPerson ?? phone ?? item.email;
        const second = item.contactPerson ? phone ?? item.email : phone ? item.email : null;
        return (
          <div className="min-w-0">
            <span className="block truncate" data-tip={first ?? undefined}>
              {first}
            </span>
            {second ? (
              <span className="block truncate text-xs text-muted-foreground tabular-nums" data-tip={second}>
                {second}
              </span>
            ) : null}
          </div>
        );
      },
    },
    ...(showActivity
      ? ([
          {
            id: "operations",
            header: labels.operations,
            size: 110,
            minSize: 104,
            accessorFn: (row) => row.operations ?? undefined,
            sortUndefined: "last",
            cell: ({ row }) =>
              row.original.operations === null ? (
                empty
              ) : (
                <span className={row.original.operations === 0 ? "tabular-nums text-muted-foreground" : "tabular-nums"}>
                  {row.original.operations}
                </span>
              ),
          },
          {
            id: "lastDate",
            header: labels.lastDate,
            size: 170,
            minSize: 170,
            accessorFn: (row) => (row.lastDate ? new Date(row.lastDate).getTime() : undefined),
            sortUndefined: "last",
            cell: ({ row }) =>
              row.original.lastDate ? (
                <span className="tabular-nums">{formatDateCell(row.original.lastDate)}</span>
              ) : (
                empty
              ),
          },
          {
            id: "expense",
            header: labels.expense,
            size: 140,
            minSize: 110,
            accessorFn: (row) => row.expenseTotal || undefined,
            sortUndefined: "last",
            cell: ({ row }) =>
              row.original.expenseTotal ? (
                <Link
                  href={transactionsHref(row.original.id)}
                  className="hover:underline"
                  data-tip={`Выплачено контрагенту ${phrase}`}
                  data-tip-sub="Открыть операции"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Money value={row.original.expenseTotal} />
                </Link>
              ) : (
                empty
              ),
          },
          {
            id: "income",
            header: labels.income,
            size: 140,
            minSize: 110,
            accessorFn: (row) => row.incomeTotal || undefined,
            sortUndefined: "last",
            cell: ({ row }) =>
              row.original.incomeTotal ? (
                <span data-tip={`Получено от контрагента ${phrase}`}>
                  <Money value={row.original.incomeTotal} />
                </span>
              ) : (
                empty
              ),
          },
        ] satisfies ColumnDef<Row>[])
      : []),
    {
      id: "actions",
      size: ROW_MENU_COLUMN_SIZE,
      minSize: ROW_MENU_COLUMN_SIZE,
      maxSize: ROW_MENU_COLUMN_SIZE,
      enableHiding: false,
      enableResizing: false,
      enableSorting: false,
      cell: ({ row }) => (
        <TableRowMenu label={`Действия с контрагентом «${row.original.name}»`} actions={menuActions(row.original)} />
      ),
    },
  ];

  const table = useReactTable({
    data: filtered,
    columns,
    state: {
      sorting: st.sorting,
      pagination: st.pagination,
      columnVisibility: {
        ...st.columnVisibility,
        name: true,
        actions: true,
        ...(showActivity ? {} : { operations: false, lastDate: false, expense: false, income: false }),
      },
      columnOrder: st.columnOrder,
      columnSizing: st.columnSizing,
    },
    onSortingChange: st.setSorting,
    onPaginationChange: st.setPagination,
    onColumnVisibilityChange: st.setColumnVisibility,
    onColumnSizingChange: st.setColumnSizing,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  });
  const changeSorting = (next: typeof st.sorting) => {
    st.setSorting(next);
    firstPage();
  };

  // Итоги — по отфильтрованному списку, всех страниц.
  const totals =
    showActivity && hasActivity
      ? {
          name: <span className="font-medium">Итого</span>,
          operations: (
            <span className="tabular-nums">{filtered.reduce((sum, row) => sum + (row.operations ?? 0), 0)}</span>
          ),
          expense: <Money value={filtered.reduce((sum, row) => sum + (row.expenseTotal ?? 0), 0)} />,
          income: <Money value={filtered.reduce((sum, row) => sum + (row.incomeTotal ?? 0), 0)} />,
        }
      : undefined;

  const toggleArchive = () => {
    setShowArchive((value) => !value);
    firstPage();
  };

  const groupFilterOptions = [
    { value: "", label: "Все группы" },
    ...[...groups].sort((a, b) => collator.compare(a.name, b.name)).map((group) => ({ value: group.id, label: group.name })),
    { value: "none", label: "Без группы" },
  ];

  let body: React.ReactNode;
  if (modeRows.length === 0) {
    body = showArchive ? (
      <EmptyState
        icon={Archive}
        title="Архив пуст"
        description="Сюда попадают контрагенты, с которыми больше не работают. Операции с ними сохраняются"
        action={
          <Button variant="outline" onClick={toggleArchive}>
            К действующим контрагентам
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={Users}
        title="Контрагентов пока нет"
        description={
          archivedRows.length > 0
            ? "Все контрагенты в архиве"
            : canManage
              ? "Поставщики, покупатели и подрядчики, с которыми проходят операции"
              : "Контрагентов добавляет сотрудник с правом управлять контрагентами"
        }
      />
    );
  } else if (filtered.length === 0) {
    body = (
      <EmptyState
        icon={SearchX}
        title="Контрагенты не найдены"
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
      <>
        <DataTable
          table={table}
          label={showArchive ? "Контрагенты в архиве" : "Контрагенты"}
          labels={labels}
          onColumnSizingChange={st.setColumnSizing}
          sorting={st.sorting}
          onSortingChange={changeSorting}
          sortable={sortFields}
          numeric={["operations", "expense", "income"]}
          onRowClick={(row) => router.push(cardHref(row.original.id))}
          totals={totals}
          empty={null}
          mobile={{ label: "Карточки контрагентов", nameColumn: "name" }}
        />
        <TablePagination
          pageIndex={st.pagination.pageIndex}
          pageSize={st.pagination.pageSize}
          total={filtered.length}
          onPageChange={(pageIndex) => st.setPagination((p) => ({ ...p, pageIndex }))}
          onPageSizeChange={(pageSize) => st.setPagination({ pageIndex: 0, pageSize })}
        />
      </>
    );
  }

  return (
    <PageFrame className="flex min-w-0 flex-col gap-4">
      <Breadcrumbs items={[{ label: "Финансы" }, { label: "Контрагенты" }]} />
      <TablePageHeader
        title="Контрагенты"
        count={isFiltered ? `${filtered.length} из ${modeRows.length}` : modeRows.length}
        period={
          showActivity ? (
            <DirectoryPeriodPicker
              value={period}
              today={today}
              onChange={changePeriod}
              ariaLabel="Период операций с контрагентами"
            />
          ) : undefined
        }
        actions={
          <TableControls
            search={{
              value: st.search,
              onChange: (value) => {
                st.setSearch(value);
                firstPage();
              },
              open: st.searchOpen,
              onOpenChange: st.setSearchOpen,
              placeholder: "Название, ИНН, контакт",
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
                  <TableIconButton label="Группы контрагентов" onClick={() => setGroupsOpen(true)}>
                    <FolderTree />
                  </TableIconButton>
                ) : null}
                {isOwner && (archivedRows.length > 0 || showArchive) ? (
                  <TableIconButton
                    label={
                      showArchive ? "Вернуться к действующим контрагентам" : `Архив контрагентов · ${archivedRows.length}`
                    }
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
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                  Новый контрагент
                </Button>
              ) : null
            }
          />
        }
      />
      <TableConditions
        label="Условия списка контрагентов"
        open={filtersOpen}
        hasFilters={hasFilters}
        sorting={st.sorting}
        onSortingChange={changeSorting}
        sortFields={sortFields}
        sortLabels={labels}
        search={st.search}
        onSearchClear={() => {
          st.setSearch("");
          firstPage();
        }}
        onReset={resetConditions}
      >
        {(filtersOpen || !!groupFilter) && (
          <TableFilterChip
            label="Группа"
            value={groupFilter}
            onChange={(value) => {
              setGroupFilter(value);
              firstPage();
            }}
            options={groupFilterOptions}
          />
        )}
        {(filtersOpen || !!supplierFilter) && (
          <TableFilterChip
            label="Тип"
            value={supplierFilter}
            onChange={(value) => {
              setSupplierFilter(value);
              firstPage();
            }}
            options={[
              { value: "", label: "Все контрагенты" },
              { value: "suppliers", label: "Поставщики" },
              { value: "others", label: "Не поставщики" },
            ]}
          />
        )}
        {(filtersOpen || !!certificateFilter) && (
          <TableFilterChip
            label="Сертификаты"
            value={certificateFilter}
            onChange={(value) => {
              setCertificateFilter(value);
              firstPage();
            }}
            options={[
              { value: "", label: "Все контрагенты" },
              { value: "alert", label: "Истекают или просрочены" },
            ]}
          />
        )}
        {showActivity && (filtersOpen || !!activityFilter) && (
          <TableFilterChip
            label="Операции"
            value={activityFilter}
            onChange={(value) => {
              setActivityFilter(value);
              firstPage();
            }}
            options={[
              { value: "", label: "Все контрагенты" },
              { value: "with", label: "Есть операции" },
              { value: "without", label: "Без операций" },
            ]}
          />
        )}
      </TableConditions>

      {showActivity && !hasActivity && modeRows.length > 0 ? (
        <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          Не удалось посчитать операции с контрагентами: в столбцах активности прочерки. Обновите страницу позже
        </div>
      ) : null}

      {/* Пока считается новый период, старые цифры приглушены. */}
      <div aria-busy={periodPending} className={cn("min-w-0 transition-opacity", periodPending && "opacity-60")}>
        {body}
      </div>

      <CounterpartyCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        dadataEnabled={dadataEnabled}
        groups={groups}
        onCreated={(id) => router.push(cardHref(id))}
      />

      <GroupsDrawer
        open={groupsOpen}
        onOpenChange={setGroupsOpen}
        title="Группы контрагентов"
        description="Группа собирает контрагентов в списке: поставщики, арендодатели, подрядчики. Удаление группы не удаляет контрагентов"
        noun={["контрагент", "контрагента", "контрагентов"]}
        groups={[...groups]
          .sort((a, b) => collator.compare(a.name, b.name))
          .map((group) => ({ id: group.id, name: group.name, count: groupCounts.get(group.id) ?? 0 }))}
        onCreate={async ({ name }) => afterGroupChange(await createCounterpartyGroup({ name }).then((r) => ({ error: r.error })))}
        onUpdate={async (id, { name }) => afterGroupChange(await updateCounterpartyGroup(id, { name }))}
        onDelete={async (id) => afterGroupChange(await deleteCounterpartyGroup(id))}
      />

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open && !archiveBusy) setArchiveTarget(null);
        }}
        title={archiveTarget ? `Отправить контрагента «${archiveTarget.name}» в архив?` : "Отправить контрагента в архив?"}
        description={
          <>
            Контрагент пропадёт из списка и из выбора в новых операциях. Это не удаление:
            {archiveTarget?.operations
              ? ` ${countRu(archiveTarget.operations, "операция", "операции", "операций")} сохранят контрагента, документы останутся в карточке.`
              : " документы останутся в карточке."}{" "}
            Найти контрагента можно по кнопке «Архив» в ряду инструментов.
          </>
        }
        confirmLabel="В архив"
        pendingLabel="Отправляем…"
        busy={archiveBusy}
        error={archiveError}
        onConfirm={() => void confirmArchive()}
      />

      {shownDelete ? (
        <HardDeleteConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => {
            if (!open) {
              setDeleteTarget(null);
              setDeleteImpact(null);
            }
          }}
          entityGenitive="контрагента"
          entityName={shownDelete.target.name}
          impact={counterpartyDeleteImpact(shownDelete.impact)}
          restrictedBy={[]}
          onConfirm={async () => {
            const result = await deleteCounterparty(shownDelete.target.id, { confirmName: shownDelete.target.name });
            if (result.error) return { error: result.error };
            toast.success(`Контрагент «${shownDelete.target.name}» удалён`);
            setDeleteTarget(null);
            setDeleteImpact(null);
            router.refresh();
          }}
        />
      ) : null}
    </PageFrame>
  );
}

/** Что уйдёт вместе с контрагентом и что останется без него — общее для списка и карточки. */
export function counterpartyDeleteImpact(impact: CounterpartyArchiveImpact | null): DeleteImpact[] {
  if (!impact) return [];
  return [
    { label: "Документы", count: impact.attachments, tone: "cascade" },
    { label: "Сертификаты и лицензии", count: impact.certificates, tone: "cascade" },
    { label: "Связи с номенклатурой", count: impact.ingredient_suppliers, tone: "cascade" },
    { label: "Операции останутся без контрагента", count: impact.transactions, tone: "unbind" },
  ];
}
