"use client";

import { useMemo, useState } from "react";
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
  Pause,
  PencilLine,
  Play,
  Repeat,
  SearchX,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { HardDeleteConfirmDialog } from "@/components/shared/hard-delete-confirm-dialog";
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
import {
  archiveRecurringTemplate,
  deleteRecurringTemplate,
  pauseRecurringTemplate,
  restoreRecurringTemplate,
  resumeRecurringTemplate,
} from "@/lib/finance/recurring";
import { describeSchedule, scheduleFromTemplate } from "@/lib/finance/recurring-schedule";
import type { AmountRoundingScale } from "@/lib/format/amount";
import { formatDateCell } from "@/lib/format/date";
import type { AccountVenueRow } from "@/lib/org/legal-entities";
import type {
  BankAccountRow,
  CounterpartyRow,
  FinanceCategoryRow,
  RecurringTemplateListItem,
} from "@/types/finance";

import { TxAmount, signedTxAmount } from "../../transactions/_components/transaction-cells";
import { RecurringFormSheet, type RecurringFormMode } from "./recurring-form-sheet";

type ColKey = "name" | "amount" | "schedule" | "next_due" | "account" | "status";

const labels: Record<ColKey, string> = {
  name: "Название",
  amount: "Сумма",
  schedule: "Расписание",
  next_due: "Ближайший срок",
  account: "Счёт",
  status: "Состояние",
};

// Стабильная ссылка вне компонента: useTableState пересчитывает умолчания по ней.
const columnConfig = [
  { id: "name", defaultSize: 280 },
  { id: "amount", defaultSize: 160 },
  { id: "schedule", defaultSize: 240 },
  { id: "next_due", defaultSize: 160 },
  { id: "account", defaultSize: 220 },
  { id: "status", defaultSize: 130 },
  { id: "actions", defaultSize: ROW_MENU_COLUMN_SIZE },
];
const sortFields: ColKey[] = ["name", "amount", "next_due", "account", "status"];

const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });
const UNDO_WINDOW_MS = 15_000;
const NETWORK_ERROR = "Нет связи с сервером. Проверьте соединение и повторите";

type Permissions = {
  create: boolean;
  delete: boolean;
  manageCategories: boolean;
  manageCounterparties: boolean;
};

type Row = RecurringTemplateListItem & {
  accountName: string | null;
  /** Валюта счёта: сумма шаблона в ней и проводится. */
  accountCurrency: string;
  /** Контрагент и статья — вторая строка в названии и поиск. */
  details: string | null;
  scheduleText: string;
};

export function RecurringPage({
  templates,
  loadError,
  bankAccounts,
  categories,
  counterparties,
  venues,
  formVenues,
  permissions,
  amountRoundingScale,
  dadataEnabled,
  timeZone,
  initialArchive,
}: {
  templates: RecurringTemplateListItem[];
  loadError: string | null;
  /** Все счета, статьи и контрагенты — включая архивные (для подписей). */
  bankAccounts: BankAccountRow[];
  categories: FinanceCategoryRow[];
  counterparties: CounterpartyRow[];
  /** Действующие заведения аккаунта. */
  venues: AccountVenueRow[];
  /** Заведения, которые можно выбрать в панели. */
  formVenues: AccountVenueRow[];
  permissions: Permissions;
  amountRoundingScale: AmountRoundingScale;
  dadataEnabled: boolean;
  timeZone: string;
  initialArchive: boolean;
}) {
  const router = useRouter();
  const st = useTableState({ tableId: "finance.recurring", columns: columnConfig });
  const firstPage = () => st.setPagination((p) => ({ ...p, pageIndex: 0 }));
  const canManage = permissions.create;

  const activeAccounts = useMemo(() => bankAccounts.filter((b) => !b.deleted_at), [bankAccounts]);
  const rows: Row[] = useMemo(() => {
    const accountById = new Map(bankAccounts.map((b) => [b.id, b]));
    const counterpartyById = new Map(counterparties.map((c) => [c.id, c.name]));
    const categoryById = new Map(categories.map((c) => [c.id, c.name]));
    return templates.map((t) => {
      const text = describeSchedule(scheduleFromTemplate(t));
      const details = [
        t.counterparty_id ? counterpartyById.get(t.counterparty_id) : null,
        t.category_id ? categoryById.get(t.category_id) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        ...t,
        accountName: accountById.get(t.bank_account_id)?.name ?? null,
        accountCurrency: accountById.get(t.bank_account_id)?.currency ?? t.currency,
        details: details || null,
        scheduleText: text.charAt(0).toUpperCase() + text.slice(1),
      };
    });
  }, [bankAccounts, categories, counterparties, templates]);

  const [showArchive, setShowArchive] = useState(initialArchive);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");

  const liveRows = useMemo(() => rows.filter((row) => !row.archived_at), [rows]);
  const archivedRows = useMemo(() => rows.filter((row) => row.archived_at), [rows]);
  const modeRows = showArchive ? archivedRows : liveRows;

  const q = st.search.toLocaleLowerCase("ru").trim();
  const filtered = useMemo(
    () =>
      modeRows.filter((row) => {
        if (
          q &&
          ![row.name, row.details, row.description, row.accountName].some((value) =>
            value?.toLocaleLowerCase("ru").includes(q),
          )
        )
          return false;
        if (!showArchive && statusFilter === "active" && row.paused_at) return false;
        if (!showArchive && statusFilter === "paused" && !row.paused_at) return false;
        return true;
      }),
    [modeRows, q, showArchive, statusFilter],
  );
  const hasFilters = !showArchive && Boolean(statusFilter);
  const isFiltered = q.length > 0 || hasFilters;
  const resetConditions = () => {
    setStatusFilter("");
    st.setSearch("");
    st.setSorting([]);
    firstPage();
  };

  // ── Панель ─────────────────────────────────────────────────

  const [formMode, setFormMode] = useState<RecurringFormMode>({ kind: "closed" });

  // ── Пауза, архив, возврат, удаление ────────────────────────

  const [archiveTarget, setArchiveTarget] = useState<Row | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);

  const togglePause = async (row: Row) => {
    const paused = Boolean(row.paused_at);
    const { error } = await (paused
      ? resumeRecurringTemplate(row.id)
      : pauseRecurringTemplate(row.id)
    ).catch(() => ({ error: NETWORK_ERROR }));
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(paused ? `Платёж «${row.name}» снова активен` : `Платёж «${row.name}» на паузе`);
    router.refresh();
  };

  const restore = async (row: Pick<Row, "id" | "name">) => {
    const { error } = await restoreRecurringTemplate(row.id).catch(() => ({ error: NETWORK_ERROR }));
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(`Платёж «${row.name}» возвращён из архива`);
    router.refresh();
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    const row = archiveTarget;
    setArchiveBusy(true);
    setArchiveError(null);
    const { error } = await archiveRecurringTemplate(row.id).catch(() => ({ error: NETWORK_ERROR }));
    setArchiveBusy(false);
    if (error) {
      setArchiveError(error);
      return;
    }
    setArchiveTarget(null);
    toast(`Платёж «${row.name}» в архиве`, {
      duration: UNDO_WINDOW_MS,
      action: { label: "Отменить", onClick: () => void restore(row) },
    });
    router.refresh();
  };

  const menuActions = (row: Row): TableRowMenuAction[] => {
    if (row.archived_at) {
      return [
        ...(canManage
          ? [{ label: "Восстановить", icon: <ArchiveRestore />, onSelect: () => void restore(row) }]
          : []),
        ...(permissions.delete
          ? [
              {
                label: "Удалить навсегда",
                icon: <Trash2 />,
                destructive: true,
                separatorBefore: canManage,
                onSelect: () => setDeleteTarget(row),
              },
            ]
          : []),
      ];
    }
    if (!canManage) return [];
    return [
      {
        label: "Изменить",
        icon: <PencilLine />,
        onSelect: () => setFormMode({ kind: "edit", template: row }),
      },
      row.paused_at
        ? { label: "Возобновить", icon: <Play />, onSelect: () => void togglePause(row) }
        : { label: "Приостановить", icon: <Pause />, onSelect: () => void togglePause(row) },
      {
        label: "Архивировать",
        icon: <Archive />,
        separatorBefore: true,
        onSelect: () => {
          setArchiveError(null);
          setArchiveTarget(row);
        },
      },
    ];
  };
  const hasMenu = showArchive ? canManage || permissions.delete : canManage;

  // ── Таблица ────────────────────────────────────────────────

  const empty = <span className="text-muted-foreground">—</span>;

  const columns: ColumnDef<Row>[] = [
    {
      id: "name",
      header: labels.name,
      size: 280,
      minSize: 180,
      enableHiding: false,
      accessorFn: (row) => row.name,
      sortingFn: (a, b) => collator.compare(a.original.name, b.original.name),
      cell: ({ row }) => {
        const item = row.original;
        const second = item.archived_at
          ? `В архиве с ${formatDateCell(item.archived_at, timeZone)}`
          : item.details;
        return (
          <div className="min-w-0">
            {/* Настоящая кнопка в первой ячейке: панель открывается и с клавиатуры. */}
            {showArchive ? (
              <span className="block truncate font-medium" data-tip={item.name}>
                {item.name}
              </span>
            ) : (
              <button
                type="button"
                className="block max-w-full truncate text-left font-medium hover:underline"
                data-tip={item.name}
                onClick={(event) => {
                  event.stopPropagation();
                  setFormMode({ kind: "edit", template: item });
                }}
              >
                {item.name}
              </button>
            )}
            {second ? (
              <span className="block truncate text-xs text-muted-foreground" data-tip={second}>
                {second}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "amount",
      header: labels.amount,
      size: 160,
      minSize: 110,
      accessorFn: (row) => signedTxAmount(row),
      cell: ({ row }) => (
        <span
          className="whitespace-nowrap tabular-nums"
          data-tip={row.original.amount_varies ? "Сумма меняется: указывается при проведении" : undefined}
        >
          {row.original.amount_varies ? <span className="text-muted-foreground">~</span> : null}
          <TxAmount
            value={signedTxAmount(row.original)}
            currency={row.original.accountCurrency}
            signed
            scale={amountRoundingScale}
          />
        </span>
      ),
    },
    {
      id: "schedule",
      header: labels.schedule,
      size: 240,
      minSize: 150,
      enableSorting: false,
      accessorFn: (row) => row.scheduleText,
      cell: ({ row }) => {
        const until = row.original.ends_on ? `до ${formatDateCell(row.original.ends_on)}` : null;
        return (
          <div className="min-w-0">
            <span className="block truncate" data-tip={row.original.scheduleText}>
              {row.original.scheduleText}
            </span>
            {until ? (
              <span className="block truncate text-xs text-muted-foreground tabular-nums">{until}</span>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "next_due",
      header: labels.next_due,
      size: 160,
      minSize: 150,
      accessorFn: (row) => row.next_due ?? undefined,
      sortUndefined: "last",
      cell: ({ row }) =>
        row.original.next_due ? (
          <span className="tabular-nums">{formatDateCell(row.original.next_due)}</span>
        ) : (
          empty
        ),
    },
    {
      id: "account",
      header: labels.account,
      size: 220,
      minSize: 120,
      accessorFn: (row) => row.accountName ?? undefined,
      sortUndefined: "last",
      sortingFn: (a, b) => collator.compare(a.original.accountName ?? "", b.original.accountName ?? ""),
      cell: ({ row }) => {
        const name = row.original.accountName ?? "Счёт недоступен";
        return (
          <span
            className={row.original.accountName ? "block truncate" : "block truncate text-muted-foreground"}
            data-tip={name}
          >
            {name}
          </span>
        );
      },
    },
    {
      id: "status",
      header: labels.status,
      size: 130,
      minSize: 110,
      accessorFn: (row) => (row.paused_at ? 1 : 0),
      cell: ({ row }) =>
        row.original.paused_at ? (
          <StatusBadge tone="neutral">На паузе</StatusBadge>
        ) : (
          <StatusBadge tone="success">Активен</StatusBadge>
        ),
    },
    {
      id: "actions",
      size: ROW_MENU_COLUMN_SIZE,
      minSize: ROW_MENU_COLUMN_SIZE,
      maxSize: ROW_MENU_COLUMN_SIZE,
      enableHiding: false,
      enableResizing: false,
      enableSorting: false,
      cell: ({ row }) => {
        const actions = menuActions(row.original);
        return actions.length ? (
          <TableRowMenu label={`Действия с платежом «${row.original.name}»`} actions={actions} />
        ) : null;
      },
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
        actions: hasMenu,
        // В архиве ближайшего срока и состояния нет.
        ...(showArchive ? { next_due: false, status: false } : {}),
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
  const modeSortFields = showArchive
    ? sortFields.filter((f) => f !== "next_due" && f !== "status")
    : sortFields;

  const toggleArchive = () => {
    setShowArchive((value) => !value);
    firstPage();
  };

  let body: React.ReactNode;
  if (modeRows.length === 0) {
    body = showArchive ? (
      <EmptyState
        icon={Archive}
        title="Архив пуст"
        description="Сюда попадают повторяющиеся платежи, которые больше не нужны. Проведённые по ним операции сохраняются"
        action={
          <Button variant="outline" onClick={toggleArchive}>
            К действующим платежам
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={Repeat}
        title="Повторяющихся платежей пока нет"
        description={
          archivedRows.length > 0
            ? "Все повторяющиеся платежи в архиве"
            : canManage
              ? "Создайте из операции в «Транзакциях» — пункт «Сделать повторяющейся» в меню строки"
              : "Повторяющиеся платежи заводит сотрудник с правом создавать операции"
        }
        action={
          canManage ? <Button onClick={() => setFormMode({ kind: "create" })}>Создать</Button> : undefined
        }
      />
    );
  } else if (filtered.length === 0) {
    body = (
      <EmptyState
        icon={SearchX}
        title="Платежи не найдены"
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
          label={showArchive ? "Повторяющиеся платежи в архиве" : "Повторяющиеся платежи"}
          labels={labels}
          onColumnSizingChange={st.setColumnSizing}
          sorting={st.sorting}
          onSortingChange={changeSorting}
          sortable={modeSortFields}
          numeric={["amount"]}
          onRowClick={
            showArchive ? undefined : (row) => setFormMode({ kind: "edit", template: row.original })
          }
          empty={null}
          mobile={{ label: "Карточки повторяющихся платежей", nameColumn: "name", statusColumn: "status" }}
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
      <Breadcrumbs items={[{ label: "Финансы" }, { label: "Повторяющиеся платежи" }]} />
      <TablePageHeader
        title="Повторяющиеся платежи"
        count={isFiltered ? `${filtered.length} из ${modeRows.length}` : modeRows.length}
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
              placeholder: "Название, контрагент, статья",
            }}
            filters={
              showArchive
                ? undefined
                : { active: hasFilters, onClick: () => setFiltersOpen((value) => !value) }
            }
            sort={{
              active: st.sorting.length > 0,
              content: (
                <TableSortPicker
                  sorting={st.sorting}
                  onChange={changeSorting}
                  fields={modeSortFields}
                  labels={labels}
                />
              ),
            }}
            columns={{
              content: (
                <TableColumnManager
                  columns={st.columnOrder
                    .filter(
                      (id) =>
                        id !== "actions" && !(showArchive && (id === "next_due" || id === "status")),
                    )
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
              archivedRows.length > 0 || showArchive ? (
                <TableIconButton
                  label={
                    showArchive
                      ? "Вернуться к действующим платежам"
                      : `Архив повторяющихся платежей · ${archivedRows.length}`
                  }
                  active={showArchive}
                  onClick={toggleArchive}
                >
                  <Archive />
                </TableIconButton>
              ) : null
            }
            primaryActions={
              canManage && !showArchive ? (
                <Button onClick={() => setFormMode({ kind: "create" })}>Создать</Button>
              ) : null
            }
          />
        }
      />
      <TableConditions
        label="Условия списка повторяющихся платежей"
        open={filtersOpen && !showArchive}
        hasFilters={hasFilters}
        sorting={st.sorting}
        onSortingChange={changeSorting}
        sortFields={modeSortFields}
        sortLabels={labels}
        search={st.search}
        onSearchClear={() => {
          st.setSearch("");
          firstPage();
        }}
        onReset={resetConditions}
      >
        {!showArchive && (filtersOpen || !!statusFilter) && (
          <TableFilterChip
            label="Состояние"
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value);
              firstPage();
            }}
            options={[
              { value: "", label: "Все платежи" },
              { value: "active", label: "Активные" },
              { value: "paused", label: "На паузе" },
            ]}
          />
        )}
      </TableConditions>

      {loadError ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          Не удалось загрузить повторяющиеся платежи. Обновите страницу
        </div>
      ) : null}

      <div className="min-w-0">{body}</div>

      <RecurringFormSheet
        mode={formMode}
        onClose={() => setFormMode({ kind: "closed" })}
        onSaved={({ created }) => {
          setFormMode({ kind: "closed" });
          toast.success(created ? "Повторяющийся платёж создан" : "Платёж сохранён");
          router.refresh();
        }}
        bankAccounts={activeAccounts}
        allBankAccounts={bankAccounts}
        venues={formVenues}
        allVenues={venues}
        categories={categories}
        counterparties={counterparties}
        permissions={permissions}
        amountRoundingScale={amountRoundingScale}
        dadataEnabled={dadataEnabled}
        timeZone={timeZone}
      />

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open && !archiveBusy) setArchiveTarget(null);
        }}
        title={archiveTarget ? `Отправить «${archiveTarget.name}» в архив?` : "Отправить платёж в архив?"}
        description="Новые платежи по нему перестанут появляться на разбор; те, что уже ждут, останутся в очереди. Это не удаление: проведённые операции останутся в «Транзакциях». Вернуть платёж можно из архива по кнопке «Архив» в ряду инструментов."
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
          entityGenitive="повторяющийся платёж"
          entityName={deleteTarget.name}
          impact={[]}
          restrictedBy={[]}
          onConfirm={async () => {
            const result = await deleteRecurringTemplate(deleteTarget.id).catch(() => ({
              error: NETWORK_ERROR,
            }));
            if (result.error) return { error: result.error };
            toast.success(`Платёж «${deleteTarget.name}» удалён`);
            setDeleteTarget(null);
            router.refresh();
          }}
        />
      ) : null}
    </PageFrame>
  );
}
