"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Archive, ArchiveRestore, ArrowLeftRight, Layers, Plus, SearchX, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ArchiveConfirmDialog } from "@/components/shared/archive-confirm-dialog";
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
import { formatDateCell } from "@/lib/format/date";
import { formatMoney, signedAmountClass, type AmountRoundingScale } from "@/lib/format/amount";
import {
  BANK_ACCOUNT_TYPE_LABELS,
  BANK_ACCOUNT_TYPE_OPTIONS,
  bankAccountSubtitle,
  formatBalance,
} from "@/lib/finance/bank-account-labels";
import {
  archiveBankAccount,
  deleteBankAccount,
  getBankAccountArchiveImpact,
  restoreBankAccount,
  type BankAccountArchiveImpact,
} from "@/lib/finance/bank-accounts";
import type { BankAccountGroupRow, BankAccountRow } from "@/types/finance";
import { BankAccountCreateDrawer } from "./bank-account-create-drawer";
import { BankAccountGroupsDrawer } from "./bank-account-groups-drawer";
import type { BankAccountLegalEntityOption, BankAccountVenueOption } from "./bank-account-form";
import { BankAccountIcon } from "./bank-account-icon";
import { bankAccountDeleteRestrictions } from "./bank-account-restrictions";

type ColKey = "name" | "type" | "legalEntity" | "venue" | "group" | "balance";

const labels: Record<ColKey, string> = {
  name: "Счёт",
  type: "Тип",
  legalEntity: "Юрлицо",
  venue: "Заведение",
  group: "Группа",
  balance: "Баланс",
};
const columnConfig = [
  { id: "name", defaultSize: 320 },
  { id: "type", defaultSize: 150 },
  { id: "legalEntity", defaultSize: 200 },
  { id: "venue", defaultSize: 190 },
  { id: "group", defaultSize: 160 },
  { id: "balance", defaultSize: 170 },
  { id: "actions", defaultSize: ROW_MENU_COLUMN_SIZE },
];
const sortFields: ColKey[] = ["name", "type", "legalEntity", "venue", "group", "balance"];
const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });
const UNDO_WINDOW_MS = 15_000;

type AccountView = BankAccountRow & {
  typeLabel: string;
  legalEntityLabel: string;
  venueLabel: string | null;
  groupLabel: string | null;
  subtitle: string;
};

export function AccountsList({
  accounts,
  groups,
  legalEntities,
  venues,
  canManage,
  canViewTransactions,
  isOwner,
  canHardDelete,
  initialLegalEntityId,
  openCreate,
  openArchive,
  amountRoundingScale,
}: {
  /** Действующие счета и (владельцу) архивные. */
  accounts: BankAccountRow[];
  groups: BankAccountGroupRow[];
  legalEntities: BankAccountLegalEntityOption[];
  venues: BankAccountVenueOption[];
  canManage: boolean;
  canViewTransactions: boolean;
  /** Архив, возврат и удаление — только владелец аккаунта (сервер проверяет его же). */
  isOwner: boolean;
  canHardDelete: boolean;
  /** Юрлицо из переключателя раздела «Финансы»: фильтр по нему включён сразу. */
  initialLegalEntityId: string | null;
  /** `?create=1` — открыть панель создания (старый адрес «/new»). */
  openCreate: boolean;
  /** `?archive=1` — открыть архив (старый адрес «/archive»). */
  openArchive: boolean;
  amountRoundingScale: AmountRoundingScale;
}) {
  const router = useRouter();
  const st = useTableState({ tableId: "finance.accounts", columns: columnConfig });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [legalEntityFilter, setLegalEntityFilter] = useState(
    initialLegalEntityId && legalEntities.some((le) => le.id === initialLegalEntityId) ? initialLegalEntityId : "",
  );
  const [venueFilter, setVenueFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [showArchive, setShowArchive] = useState(openArchive && isOwner);
  const [createOpen, setCreateOpen] = useState(openCreate && canManage);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const firstPage = () => st.setPagination((p) => ({ ...p, pageIndex: 0 }));

  // Параметры из старых адресов нужны один раз: убираем их, чтобы обновление
  // страницы не открывало панель или архив снова.
  useEffect(() => {
    if (openCreate || openArchive) router.replace("/finance/accounts", { scroll: false });
  }, [openCreate, openArchive, router]);

  const legalEntityName = useMemo(() => {
    const map = new Map(legalEntities.map((le) => [le.id, le.short_name?.trim() || le.name]));
    return (id: string) => map.get(id) ?? "Юрлицо в архиве";
  }, [legalEntities]);
  const venueName = useMemo(() => new Map(venues.map((v) => [v.id, v.name])), [venues]);
  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);
  // Порядок групп задают в панели «Группы счетов» — по нему и фильтр, и
  // сортировка столбца, а не по алфавиту.
  const groupRank = useMemo(() => new Map(groups.map((g, i) => [g.id, i])), [groups]);
  const accountsByGroup = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of accounts) {
      if (a.group_id && !a.deleted_at) counts.set(a.group_id, (counts.get(a.group_id) ?? 0) + 1);
    }
    return counts;
  }, [accounts]);

  const rows: AccountView[] = useMemo(
    () =>
      accounts.map((a) => ({
        ...a,
        typeLabel: BANK_ACCOUNT_TYPE_LABELS[a.type] ?? a.type,
        legalEntityLabel: legalEntityName(a.legal_entity_id),
        venueLabel: a.venue_id ? (venueName.get(a.venue_id) ?? "Заведение в архиве") : null,
        groupLabel: a.group_id ? (groupName.get(a.group_id) ?? null) : null,
        subtitle: bankAccountSubtitle(a),
      })),
    [accounts, legalEntityName, venueName, groupName],
  );
  const liveRows = useMemo(() => rows.filter((a) => !a.deleted_at), [rows]);
  const archivedRows = useMemo(() => rows.filter((a) => a.deleted_at), [rows]);
  const modeRows = showArchive ? archivedRows : liveRows;

  const q = st.search.toLocaleLowerCase("ru").trim();
  const filtered = useMemo(
    () =>
      modeRows.filter((a) => {
        if (
          q &&
          ![a.name, a.bank_name, a.description, a.card_number_last4].some((text) =>
            text?.toLocaleLowerCase("ru").includes(q),
          )
        )
          return false;
        if (typeFilter && a.type !== typeFilter) return false;
        if (legalEntityFilter && a.legal_entity_id !== legalEntityFilter) return false;
        if (venueFilter === "none" && a.venue_id) return false;
        if (venueFilter && venueFilter !== "none" && a.venue_id !== venueFilter) return false;
        if (groupFilter === "none" && a.group_id) return false;
        if (groupFilter && groupFilter !== "none" && a.group_id !== groupFilter) return false;
        return true;
      }),
    [modeRows, q, typeFilter, legalEntityFilter, venueFilter, groupFilter],
  );
  const hasFilters = Boolean(typeFilter || legalEntityFilter || venueFilter || groupFilter);
  const isFiltered = q.length > 0 || hasFilters;
  const resetConditions = () => {
    setTypeFilter("");
    setLegalEntityFilter("");
    setVenueFilter("");
    setGroupFilter("");
    st.setSearch("");
    st.setSorting([]);
    firstPage();
  };
  const setFilter = (set: (v: string) => void) => (v: string) => {
    set(v);
    firstPage();
  };

  // В фильтрах — только то, что встречается у счетов текущего режима.
  const filterOptions = useMemo(() => {
    const uniq = (pairs: [string, string][]) =>
      [...new Map(pairs)].sort((a, b) => collator.compare(a[1], b[1])).map(([value, label]) => ({ value, label }));
    return {
      legalEntities: uniq(modeRows.map((a) => [a.legal_entity_id, a.legalEntityLabel])),
      venues: uniq(modeRows.flatMap((a) => (a.venue_id && a.venueLabel ? [[a.venue_id, a.venueLabel] as [string, string]] : []))),
      groups: groups
        .filter((g) => modeRows.some((a) => a.group_id === g.id))
        .map((g) => ({ value: g.id, label: g.name })),
    };
  }, [modeRows, groups]);

  // ── Архив, возврат, удаление ───────────────────────────────

  const [archiveTarget, setArchiveTarget] = useState<AccountView | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<AccountView | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountView | null>(null);
  const [impact, setImpact] = useState<BankAccountArchiveImpact | null>(null);

  const loadImpact = (account: AccountView) => {
    setImpact(null);
    getBankAccountArchiveImpact(account.id)
      .then(setImpact)
      .catch(() => setImpact({ transactions: 0 }));
  };

  const restore = async (account: Pick<AccountView, "id" | "name">) => {
    const { error } = await restoreBankAccount(account.id).catch(() => ({
      error: "Не удалось вернуть счёт. Проверьте соединение и повторите",
    }));
    if (error) return { error };
    toast.success(`Счёт «${account.name}» снова в работе`);
    router.refresh();
    return { error: null };
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    const account = archiveTarget;
    const result = await archiveBankAccount(account.id, { confirmName: account.name }).catch(() => ({
      error: "Не удалось отправить счёт в архив. Проверьте соединение и повторите",
    }));
    if (result.error) return { error: result.error };
    setArchiveTarget(null);
    toast(`Счёт «${account.name}» в архиве`, {
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Отменить",
        onClick: () =>
          void restore(account).then((r) => {
            if (r.error) toast.error(r.error);
          }),
      },
    });
    router.refresh();
    return { error: null };
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const account = deleteTarget;
    const result = await deleteBankAccount(account.id, { confirmName: account.name }).catch(() => ({
      error: "Не удалось удалить счёт. Проверьте соединение и повторите",
    }));
    if (result.error) return { error: result.error };
    setDeleteTarget(null);
    toast.success(`Счёт «${account.name}» удалён`);
    router.refresh();
    return { error: null };
  };

  const menuActions = (account: AccountView): TableRowMenuAction[] => {
    const transactions: TableRowMenuAction[] = canViewTransactions
      ? [
          {
            label: "Операции по счёту",
            icon: <ArrowLeftRight />,
            onSelect: () => router.push(`/finance/transactions?bank_account_id=${account.id}`),
          },
        ]
      : [];
    if (!isOwner) return transactions;
    if (account.deleted_at)
      return [
        ...transactions,
        {
          label: "Вернуть из архива",
          icon: <ArchiveRestore />,
          separatorBefore: transactions.length > 0,
          onSelect: () => {
            setRestoreError(null);
            setRestoreTarget(account);
          },
        },
        ...(canHardDelete
          ? [
              {
                label: "Удалить навсегда",
                icon: <Trash2 />,
                destructive: true,
                onSelect: () => {
                  loadImpact(account);
                  setDeleteTarget(account);
                },
              },
            ]
          : []),
      ];
    return [
      ...transactions,
      {
        label: "В архив",
        icon: <Archive />,
        separatorBefore: transactions.length > 0,
        onSelect: () => {
          loadImpact(account);
          setArchiveTarget(account);
        },
      },
    ];
  };
  const hasMenu = canViewTransactions || isOwner;

  // ── Таблица ────────────────────────────────────────────────

  const fmt = (abs: number, currency: string) => formatMoney(abs, currency, amountRoundingScale);
  const money = (a: Pick<AccountView, "balance" | "currency">) => formatBalance(Number(a.balance), a.currency, fmt);
  // Минус на счёте — повод проверить операции: красим только его, плюс и
  // ноль остаются обычными (ноль серый).
  const balanceClass = (value: number) =>
    value < 0 ? signedAmountClass(value) : value === 0 ? "text-muted-foreground" : undefined;

  const columns: ColumnDef<AccountView>[] = [
    {
      id: "name",
      header: labels.name,
      size: 320,
      minSize: 200,
      enableHiding: false,
      accessorFn: (a) => a.name,
      sortingFn: (a, b) => collator.compare(a.original.name, b.original.name),
      cell: ({ row }) => {
        const a = row.original;
        return (
          // span, а не div: правило карточки на телефоне растягивает первый
          // ребёнок div-обёртки имени на всю ширину.
          <span className="flex min-w-0 items-center gap-3">
            <BankAccountIcon type={a.type} />
            <div className="min-w-0">
              <Link
                href={`/finance/accounts/${a.id}`}
                className="block truncate font-medium transition-colors duration-200 hover:text-brand"
                data-tip={a.name}
              >
                {a.name}
              </Link>
              {a.subtitle ? (
                <div className="mt-0.5 truncate text-xs text-muted-foreground" data-tip={a.subtitle}>
                  {a.subtitle}
                </div>
              ) : null}
            </div>
          </span>
        );
      },
    },
    {
      id: "type",
      header: labels.type,
      size: 150,
      minSize: 110,
      accessorFn: (a) => a.typeLabel,
      sortingFn: (a, b) => collator.compare(a.original.typeLabel, b.original.typeLabel),
      cell: ({ row }) => <span className="block truncate">{row.original.typeLabel}</span>,
    },
    {
      id: "legalEntity",
      header: labels.legalEntity,
      size: 200,
      minSize: 120,
      accessorFn: (a) => a.legalEntityLabel,
      sortingFn: (a, b) => collator.compare(a.original.legalEntityLabel, b.original.legalEntityLabel),
      cell: ({ row }) => (
        <span className="block truncate" data-tip={row.original.legalEntityLabel}>
          {row.original.legalEntityLabel}
        </span>
      ),
    },
    {
      id: "venue",
      header: labels.venue,
      size: 190,
      minSize: 120,
      accessorFn: (a) => a.venueLabel ?? undefined,
      sortUndefined: "last",
      sortingFn: (a, b) => collator.compare(a.original.venueLabel ?? "", b.original.venueLabel ?? ""),
      cell: ({ row }) =>
        row.original.venueLabel ? (
          <span className="block truncate" data-tip={row.original.venueLabel}>
            {row.original.venueLabel}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "group",
      header: labels.group,
      size: 160,
      minSize: 110,
      accessorFn: (a) => a.groupLabel ?? undefined,
      sortUndefined: "last",
      sortingFn: (a, b) =>
        (groupRank.get(a.original.group_id ?? "") ?? 0) - (groupRank.get(b.original.group_id ?? "") ?? 0),
      cell: ({ row }) =>
        row.original.groupLabel ? (
          <span className="block truncate" data-tip={row.original.groupLabel}>
            {row.original.groupLabel}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "balance",
      header: labels.balance,
      size: 170,
      minSize: 120,
      accessorFn: (a) => Number(a.balance),
      cell: ({ row }) => {
        const a = row.original;
        if (showArchive && a.deleted_at)
          return (
            <span className="block">
              <span className="block">{money(a)}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                В архиве с {formatDateCell(a.deleted_at)}
              </span>
            </span>
          );
        return (
          <span className="block">
            <span className={balanceClass(Number(a.balance))}>{money(a)}</span>
            {a.excluded_from_balance ? (
              <span
                className="mt-0.5 block text-xs text-muted-foreground"
                data-tip="Счёт не входит в общий баланс на дашборде и в итог списка"
              >
                Вне общего баланса
              </span>
            ) : null}
          </span>
        );
      },
    },
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
              const menu = menuActions(row.original);
              return menu.length > 0 ? <TableRowMenu actions={menu} /> : null;
            },
          } satisfies ColumnDef<AccountView>,
        ]
      : []),
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
        // Без групп столбец пустой — не показываем его вовсе.
        group: groups.length > 0 && (st.columnVisibility.group ?? true),
      },
      columnOrder: st.columnOrder,
      columnSizing: st.columnSizing,
    },
    onSortingChange: st.setSorting,
    onPaginationChange: st.setPagination,
    onColumnVisibilityChange: st.setColumnVisibility,
    onColumnSizingChange: st.setColumnSizing,
    getRowId: (a) => a.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  });
  const changeSorting = (next: typeof st.sorting) => {
    st.setSorting(next);
    firstPage();
  };

  // Итог — по счетам с учётом условий, без счетов вне общего баланса. Суммы
  // в разных валютах не складываем: итог только по рублёвым.
  const totalRows = filtered.filter((a) => !a.excluded_from_balance && (a.currency || "RUB") === "RUB");
  const total = totalRows.reduce((sum, a) => sum + Number(a.balance), 0);
  const otherCurrency = filtered.some((a) => !a.excluded_from_balance && (a.currency || "RUB") !== "RUB");
  const excludedCount = filtered.filter((a) => a.excluded_from_balance).length;
  const totalHint = [
    excludedCount > 0 ? "без счетов вне общего баланса" : null,
    otherCurrency ? "только рублёвые счета" : null,
  ]
    .filter(Boolean)
    .join(", ");

  const toggleArchive = () => {
    setShowArchive((v) => !v);
    firstPage();
  };

  const createButton = canManage && !showArchive ? (
    <Button size="sm" onClick={() => setCreateOpen(true)}>
      <Plus className="size-4" />
      Добавить счёт
    </Button>
  ) : null;

  const visibleColumnIds = columnConfig
    .map((c) => c.id)
    .filter((id) => id !== "actions" && (id !== "group" || groups.length > 0));

  return (
    <PageFrame className="flex min-w-0 flex-col gap-4">
      <Breadcrumbs items={[{ label: "Финансы" }, { label: "Счета и кассы" }]} />
      <TablePageHeader
        title={showArchive ? "Счета в архиве" : "Счета и кассы"}
        count={isFiltered ? `${filtered.length} из ${modeRows.length}` : modeRows.length}
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
              placeholder: "Название, банк или карта",
            }}
            filters={{
              active: hasFilters,
              onClick: () => setFiltersOpen((v) => !v),
            }}
            sort={{
              active: st.sorting.length > 0,
              content: (
                <TableSortPicker
                  sorting={st.sorting}
                  onChange={changeSorting}
                  fields={sortFields.filter((id) => id !== "group" || groups.length > 0)}
                  labels={labels}
                />
              ),
            }}
            columns={{
              content: (
                <TableColumnManager
                  columns={st.columnOrder
                    .filter((id) => visibleColumnIds.includes(id))
                    .map((id) => {
                      const c = table.getColumn(id)!;
                      return {
                        id,
                        label: labels[id as ColKey],
                        visible: c.getIsVisible(),
                        canHide: c.getCanHide(),
                      };
                    })}
                  onVisibilityChange={(id, v) => table.getColumn(id)?.toggleVisibility(v)}
                  onMoveColumn={(a, b) =>
                    st.setColumnOrder((order) => arrayMove(order, order.indexOf(a), order.indexOf(b)))
                  }
                  onReset={st.resetColumns}
                />
              ),
            }}
            // Архив — кнопкой в ряду инструментов (DS «Page header»); пока он
            // пуст, кнопки нет. Архив видит только владелец: возвращает и
            // удаляет счета тоже только он.
            secondaryActions={
              <>
                {canManage && !showArchive ? (
                  <TableIconButton
                    label={groups.length > 0 ? `Группы счетов · ${groups.length}` : "Группы счетов"}
                    onClick={() => setGroupsOpen(true)}
                  >
                    <Layers />
                  </TableIconButton>
                ) : null}
                {isOwner && (archivedRows.length > 0 || showArchive) ? (
                  <TableIconButton
                    label={showArchive ? "Вернуться к действующим счетам" : `Архив счетов · ${archivedRows.length}`}
                    active={showArchive}
                    onClick={toggleArchive}
                  >
                    <Archive />
                  </TableIconButton>
                ) : null}
              </>
            }
            primaryActions={createButton}
          />
        }
      />
      <TableConditions
        label="Условия списка счетов"
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
        {(filtersOpen || !!typeFilter) && (
          <TableFilterChip
            label="Тип"
            value={typeFilter}
            onChange={setFilter(setTypeFilter)}
            options={[{ value: "", label: "Все типы" }, ...BANK_ACCOUNT_TYPE_OPTIONS]}
          />
        )}
        {(filtersOpen || !!legalEntityFilter) && filterOptions.legalEntities.length > 1 && (
          <TableFilterChip
            label="Юрлицо"
            value={legalEntityFilter}
            onChange={setFilter(setLegalEntityFilter)}
            options={[{ value: "", label: "Все юрлица" }, ...filterOptions.legalEntities]}
          />
        )}
        {(filtersOpen || !!venueFilter) && (
          <TableFilterChip
            label="Заведение"
            value={venueFilter}
            onChange={setFilter(setVenueFilter)}
            options={[
              { value: "", label: "Все заведения" },
              ...filterOptions.venues,
              { value: "none", label: "Без заведения" },
            ]}
          />
        )}
        {(filtersOpen || !!groupFilter) && groups.length > 0 && (
          <TableFilterChip
            label="Группа"
            value={groupFilter}
            onChange={setFilter(setGroupFilter)}
            options={[
              { value: "", label: "Все группы" },
              ...filterOptions.groups,
              { value: "none", label: "Без группы" },
            ]}
          />
        )}
      </TableConditions>

      {modeRows.length === 0 ? (
        showArchive ? (
          <EmptyState
            icon={Archive}
            title="Архив пуст"
            description="Сюда попадают счета и кассы, которыми больше не пользуются"
            action={
              <Button variant="outline" onClick={toggleArchive}>
                К действующим счетам
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Wallet}
            title="Счетов пока нет"
            description={
              archivedRows.length > 0
                ? "Все счета в архиве"
                : canManage
                  ? "Добавьте кассу, расчётный счёт или карту: по ним будут считаться операции и баланс"
                  : "Счета добавляют те, кто управляет счетами"
            }
            action={
              canManage && archivedRows.length === 0 ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" />
                  Добавить счёт
                </Button>
              ) : undefined
            }
          />
        )
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Счета не найдены"
          description="Измените условия поиска или сбросьте фильтры"
          action={
            <Button variant="outline" onClick={resetConditions}>
              Очистить все
            </Button>
          }
        />
      ) : (
        <>
          <DataTable
            table={table}
            label={showArchive ? "Счета в архиве" : "Счета и кассы"}
            labels={labels}
            onColumnSizingChange={st.setColumnSizing}
            sorting={st.sorting}
            onSortingChange={changeSorting}
            sortable={sortFields}
            numeric={["balance"]}
            onRowClick={(row) => router.push(`/finance/accounts/${row.original.id}`)}
            empty={null}
            totals={
              showArchive
                ? undefined
                : {
                    balance: (
                      <span
                        className={`block ${balanceClass(total) ?? ""}`}
                        data-tip={totalHint ? `Итог ${totalHint}` : undefined}
                      >
                        {formatBalance(total, "RUB", fmt)}
                      </span>
                    ),
                  }
            }
            mobile={{ label: "Карточки счетов", nameColumn: "name", statusColumn: "balance" }}
          />
          <TablePagination
            pageIndex={st.pagination.pageIndex}
            pageSize={st.pagination.pageSize}
            total={filtered.length}
            onPageChange={(pageIndex) => st.setPagination((p) => ({ ...p, pageIndex }))}
            onPageSizeChange={(pageSize) => st.setPagination({ pageIndex: 0, pageSize })}
          />
        </>
      )}

      {canManage ? (
        <BankAccountCreateDrawer
          key={legalEntityFilter || "all"}
          open={createOpen}
          onOpenChange={setCreateOpen}
          legalEntities={legalEntities}
          venues={venues}
          groups={groups}
          defaultLegalEntityId={legalEntityFilter || null}
        />
      ) : null}
      {canManage ? (
        <BankAccountGroupsDrawer
          open={groupsOpen}
          onOpenChange={setGroupsOpen}
          groups={groups}
          accountsByGroup={accountsByGroup}
        />
      ) : null}

      <ArchiveConfirmDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        entityGenitive="счёт"
        entityName={archiveTarget?.name ?? ""}
        impact={[{ label: "Операции", count: impact?.transactions ?? 0 }]}
        description="Это не удаление: счёт пропадёт из выбора в новых операциях, а прежние операции и баланс сохранятся. Вернуть счёт можно из архива в любой момент"
        onConfirm={confirmArchive}
      />

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        onOpenChange={(open) => {
          if (!open && !restoreBusy) {
            setRestoreTarget(null);
            setRestoreError(null);
          }
        }}
        title={restoreTarget ? `Вернуть счёт «${restoreTarget.name}» из архива?` : "Вернуть счёт из архива?"}
        description="Счёт снова появится в выборе при создании операций"
        confirmLabel="Вернуть счёт"
        pendingLabel="Возвращаем…"
        busy={restoreBusy}
        error={restoreError}
        onConfirm={() => {
          if (!restoreTarget) return;
          setRestoreBusy(true);
          setRestoreError(null);
          void restore(restoreTarget).then((r) => {
            setRestoreBusy(false);
            if (r.error) setRestoreError(r.error);
            else setRestoreTarget(null);
          });
        }}
      />

      {deleteTarget ? (
        <HardDeleteConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setDeleteTarget(null);
              setImpact(null);
            }
          }}
          entityGenitive="счёт"
          entityName={deleteTarget.name}
          impact={[]}
          restrictedBy={bankAccountDeleteRestrictions(impact)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </PageFrame>
  );
}
