"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import {
  Copy,
  Download,
  Loader2,
  Minus,
  Paperclip,
  PencilLine,
  Plus,
  Repeat,
  RotateCcw,
  SearchX,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range-filter";
import { PageFrame } from "@/components/shared/page-frame";
import {
  DataTable,
  ROW_MENU_COLUMN_SIZE,
  TableBulkBar,
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
import { setActiveFinanceLegalEntityId } from "@/lib/finance/active-legal-entity";
import {
  restoreTransaction,
  softDeleteTransaction,
} from "@/lib/finance/transactions";
import type { QueryTransactionsResult } from "@/lib/finance/transactions-page-query";
import {
  NO_CATEGORY,
  NO_COUNTERPARTY,
  NO_VENUE,
  hasTransactionFilters,
  type TransactionQuery,
  type TransactionSortField,
} from "@/lib/finance/transaction-query";
import { formatDateCell } from "@/lib/format/date";
import { formatAmount, type AmountRoundingScale } from "@/lib/format/amount";
import { countRu } from "@/lib/format/plural";
import { cn } from "@/lib/utils";
import type {
  BankAccountRow,
  CounterpartyRow,
  FinanceCategoryRow,
  TransactionRow,
} from "@/types/finance";
import type { PostingRule } from "@/lib/finance/posting-rules/types";
import type { AccountVenueRow, LegalEntityRow } from "@/lib/org/legal-entities";

import { AmountRangeFilter } from "./filters/amount-range-filter";
import { BulkEditDialog } from "./bulk-edit-dialog";
import { TransactionFormSheet, type FormMode } from "./transaction-form-sheet";
import {
  RecurringFormSheet,
  type RecurringFormMode,
} from "../../recurring/_components/recurring-form-sheet";
import { InboxPlaque } from "../../_components/inbox-plaque";
import { TRANSACTION_CREATE_OPTIONS } from "../../_components/transaction-create-options";
import {
  AccountCell,
  CategoryCell,
  DescriptionText,
  TxAmount,
  currencySymbol,
  signedTxAmount,
} from "./transaction-cells";
import {
  SOURCE_LABEL,
  TYPE_LABEL,
  canEditTransaction,
  transactionLock,
  type LockableTransaction,
  type TransactionPermissions,
} from "../_lib/labels";

const SEARCH_DEBOUNCE_MS = 350;
const UNDO_WINDOW_MS = 15_000;

type ColKey =
  | "date"
  | "amount"
  | "category"
  | "description"
  | "counterparty"
  | "account"
  | "venue"
  | "legal_entity"
  | "source"
  | "number"
  | "created";

const labels: Record<ColKey, string> = {
  date: "Дата",
  amount: "Сумма",
  category: "Статья",
  description: "Описание",
  counterparty: "Контрагент",
  account: "Счёт",
  venue: "Заведение",
  legal_entity: "Юрлицо",
  source: "Источник",
  number: "Номер",
  created: "Создана",
};

// Стабильная ссылка вне компонента: useTableState пересчитывает умолчания по ней.
const columnConfig = [
  { id: "date", defaultSize: 120 },
  { id: "amount", defaultSize: 150 },
  { id: "category", defaultSize: 200 },
  { id: "description", defaultSize: 280 },
  { id: "counterparty", defaultSize: 200 },
  { id: "account", defaultSize: 230 },
  { id: "venue", defaultSize: 160, defaultVisible: false },
  { id: "legal_entity", defaultSize: 170, defaultVisible: false },
  { id: "source", defaultSize: 130, defaultVisible: false },
  { id: "number", defaultSize: 100, defaultVisible: false },
  { id: "created", defaultSize: 120, defaultVisible: false },
  { id: "actions", defaultSize: ROW_MENU_COLUMN_SIZE },
];

/** Столбец → поле сортировки на сервере (`finance_transactions_page`). */
const sortFields: TransactionSortField[] = ["date", "amount", "category", "counterparty", "account"];

const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

type Props = {
  result: QueryTransactionsResult;
  /** Операция из ссылки ?id= (сервер; null — нет или нет доступа). */
  linkedTransaction: TransactionRow | null;
  linkedTransactionId: string | null;
  query: TransactionQuery;
  cookieLegalEntityId: string | null;
  legalEntities: LegalEntityRow[];
  /** Все счета, статьи и контрагенты — включая архивные (для подписей старых строк). */
  bankAccounts: BankAccountRow[];
  categories: FinanceCategoryRow[];
  counterparties: CounterpartyRow[];
  /** Действующие заведения аккаунта. */
  venues: AccountVenueRow[];
  activeVenueId: string | null;
  /** Правила разнесения — для подстановки в форме операции. */
  postingRules: PostingRule[];
  /** Архивные заведения из действий правил: такие правила не срабатывают. */
  postingRuleArchivedIds: string[];
  permissions: TransactionPermissions;
  currentUserId: string | null;
  amountRoundingScale: AmountRoundingScale;
  /** DaData настроена: при создании контрагента реквизиты подтянутся по ИНН. */
  dadataEnabled: boolean;
  /** Пояс аккаунта: какой это день у операции. */
  timeZone: string;
  /** Сколько ожидаемых платежей ждут разбора — красная плашка над шапкой. */
  inboxCount?: number;
};

/** Строка списка: операция и число её файлов (`finance_transactions_page`). */
type ListRow = TransactionRow & LockableTransaction & { attachments_count?: number };

export function TransactionsPage({
  result,
  linkedTransaction,
  linkedTransactionId,
  query,
  cookieLegalEntityId,
  legalEntities,
  bankAccounts,
  categories,
  counterparties,
  venues,
  activeVenueId,
  postingRules,
  postingRuleArchivedIds,
  permissions,
  currentUserId,
  amountRoundingScale,
  dadataEnabled,
  timeZone,
  inboxCount = 0,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const { filters } = query;
  const deletedMode = !!filters.deleted;
  const rows = result.rows as ListRow[];

  // ─── Адрес — источник условий ─────────────────────────────────────────────

  const pushParams = useCallback(
    (params: URLSearchParams) => {
      const qs = params.toString();
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [pathname, router],
  );

  // Адрес, который уже отправлен, но ещё не пришёл в searchParams: два
  // быстрых изменения подряд (поиск с задержкой и клик по чипу) иначе
  // строились бы от одного старого адреса, и второе стирало бы первое.
  const pendingQs = useRef<string | null>(null);
  const currentQs = searchParams.toString();
  useEffect(() => {
    pendingQs.current = null;
  }, [currentQs]);

  /** Любая смена условий возвращает на первую страницу; смена страницы — нет. */
  const updateUrl = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(pendingQs.current ?? currentQs);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      if (!("page" in updates)) params.delete("page");
      params.delete("id");
      pendingQs.current = params.toString();
      pushParams(params);
    },
    [pushParams, currentQs],
  );

  // ─── Поиск: черновик в поле, в адрес — с задержкой ────────────────────────

  const urlQ = filters.q ?? "";
  const [searchDraft, setSearchDraft] = useState(urlQ);
  const [searchOpen, setSearchOpen] = useState(!!urlQ);
  const lastPushedQ = useRef(urlQ);
  useEffect(() => {
    // Адрес поменялся снаружи («Очистить все», чип поиска) — поле за ним.
    if (urlQ !== lastPushedQ.current) {
      lastPushedQ.current = urlQ;
      setSearchDraft(urlQ);
    }
  }, [urlQ]);
  useEffect(() => {
    const next = searchDraft.trim();
    if (next === lastPushedQ.current) return;
    const timer = setTimeout(() => {
      lastPushedQ.current = next;
      updateUrl({ q: next || null });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchDraft, updateUrl]);
  const clearSearch = () => {
    setSearchDraft("");
    lastPushedQ.current = "";
    updateUrl({ q: null });
  };

  // ─── Справочники ──────────────────────────────────────────────────────────

  const accountById = useMemo(() => new Map(bankAccounts.map((b) => [b.id, b])), [bankAccounts]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const counterpartyById = useMemo(
    () => new Map(counterparties.map((c) => [c.id, c])),
    [counterparties],
  );
  const legalEntityName = useCallback(
    (id: string | null | undefined) => {
      const le = id ? legalEntities.find((l) => l.id === id) : null;
      return le ? (le.short_name ?? le.name) : null;
    },
    [legalEntities],
  );
  const accountName = useCallback(
    (id: string | null) => (id ? (accountById.get(id)?.name ?? null) : null),
    [accountById],
  );

  const venueName = useCallback(
    (id: string | null) => (id ? (venues.find((v) => v.id === id)?.name ?? "Другое заведение") : null),
    [venues],
  );
  // В форме — заведения, операции которых пользователь увидит после
  // сохранения: без view_all_venues это только активное.
  const formVenues = useMemo(
    () => (permissions.viewAllVenues ? venues : venues.filter((v) => v.id === activeVenueId)),
    [activeVenueId, permissions.viewAllVenues, venues],
  );
  const venueOptions = useMemo(
    () => [
      { value: "", label: "Все заведения" },
      ...venues
        .slice()
        .sort((a, b) => collator.compare(a.name, b.name))
        .map((v) => ({ value: v.id, label: v.name })),
      { value: NO_VENUE, label: "Без заведения" },
    ],
    [venues],
  );

  const activeAccounts = useMemo(() => bankAccounts.filter((b) => !b.deleted_at), [bankAccounts]);

  // ─── Условия ──────────────────────────────────────────────────────────────

  const [filtersOpen, setFiltersOpen] = useState(false);
  const effectiveLegalEntityId = permissions.viewAllLegalEntities
    ? (filters.legal_entity_id ?? cookieLegalEntityId ?? "")
    : "";
  const showLegalEntityFilter = permissions.viewAllLegalEntities && legalEntities.length >= 2;
  const hasFilters =
    hasTransactionFilters(filters) || (showLegalEntityFilter && !!effectiveLegalEntityId);
  const isFiltered = hasFilters || !!urlQ;

  const sorting: SortingState = useMemo(
    () =>
      query.sort.map((mode) => {
        const [field, direction] = mode.split("_");
        return { id: field, desc: direction === "desc" };
      }),
    [query.sort],
  );
  const changeSorting = (next: SortingState) =>
    updateUrl({
      sort: next.length ? next.map((s) => `${s.id}_${s.desc ? "desc" : "asc"}`).join(",") : null,
    });

  const changeLegalEntity = async (next: string) => {
    // Юрлицо — общее для раздела «Финансы» (его же помнят дашборд и счета),
    // поэтому выбор пишется туда, а не только в адрес этой страницы.
    const { error } = await setActiveFinanceLegalEntityId(next || null);
    if (error) {
      toast.error(error);
      return;
    }
    updateUrl({ legal_entity_id: null });
    router.refresh();
  };

  const resetConditions = async () => {
    setSearchDraft("");
    lastPushedQ.current = "";
    if (cookieLegalEntityId) await setActiveFinanceLegalEntityId(null);
    const params = new URLSearchParams();
    const keep = searchParams.get("size");
    if (keep) params.set("size", keep);
    if (deletedMode) params.set("deleted", "1");
    pendingQs.current = params.toString();
    pushParams(params);
    if (cookieLegalEntityId) router.refresh();
  };

  const dateRange: DateRangeValue = useMemo(
    () => ({
      start: filters.date_from ? parseLocalDate(filters.date_from) : null,
      end: filters.date_to ? parseLocalDate(filters.date_to) : null,
    }),
    [filters.date_from, filters.date_to],
  );

  const categoryValue = [
    ...(filters.category_none ? [NO_CATEGORY] : []),
    ...(filters.category_ids ?? []),
  ];
  const counterpartyValue = [
    ...(filters.counterparty_none ? [NO_COUNTERPARTY] : []),
    ...(filters.counterparty_ids ?? []),
  ];

  // В вариантах фильтра — действующие записи и уже выбранные архивные.
  const accountOptions = useMemo(
    () =>
      bankAccounts
        .filter((b) => !b.deleted_at || filters.bank_account_ids?.includes(b.id))
        .sort((a, b) => collator.compare(a.name, b.name))
        .map((b) => ({ value: b.id, label: b.name })),
    [bankAccounts, filters.bank_account_ids],
  );
  const categoryOptions = useMemo(
    () => [
      { value: NO_CATEGORY, label: "Без статьи" },
      ...categories
        .filter((c) => !c.archived_at || filters.category_ids?.includes(c.id))
        .filter((c) => !filters.type || filters.type === "transfer" || c.type === filters.type)
        .sort((a, b) => collator.compare(a.name, b.name))
        .map((c) => ({ value: c.id, label: c.name })),
    ],
    [categories, filters.category_ids, filters.type],
  );
  const counterpartyOptions = useMemo(
    () => [
      { value: NO_COUNTERPARTY, label: "Без контрагента" },
      ...counterparties
        .filter((c) => !c.deleted_at || filters.counterparty_ids?.includes(c.id))
        .sort((a, b) => collator.compare(a.name, b.name))
        .map((c) => ({ value: c.id, label: c.name })),
    ],
    [counterparties, filters.counterparty_ids],
  );
  const legalEntityOptions = useMemo(
    () => [
      { value: "", label: "Все юрлица" },
      ...legalEntities.map((le) => ({ value: le.id, label: le.short_name ?? le.name })),
    ],
    [legalEntities],
  );

  const splitIds = (ids: string[], none: string) => ({
    ids: ids.filter((id) => id !== none),
    none: ids.includes(none),
  });

  // ─── Выбор строк ──────────────────────────────────────────────────────────

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [selectionRows, setSelectionRows] = useState(rows);
  if (selectionRows !== rows) {
    // Новая страница или условия — выбор с невидимых строк не тянем.
    setSelectionRows(rows);
    setRowSelection({});
  }
  const selected = rows.filter((tx) => rowSelection[tx.id]);
  const selectedIncome = selected
    .filter((tx) => tx.type === "income")
    .reduce((sum, tx) => sum + Number(tx.amount), 0);
  const selectedMixedCurrency = new Set(selected.map((tx) => tx.currency)).size > 1;
  const selectedExpense = selected
    .filter((tx) => tx.type === "expense")
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  // ─── Панель операции ──────────────────────────────────────────────────────

  const [formMode, setFormMode] = useState<FormMode>({ kind: "closed" });

  const linkedId = searchParams.get("id");
  const openedLinkedId = useRef<string | null>(null);
  useEffect(() => {
    // Операцию по ссылке ?id= сервер отдаёт вместе со страницей.
    if (!linkedTransactionId || openedLinkedId.current === linkedTransactionId) return;
    openedLinkedId.current = linkedTransactionId;
    if (linkedTransaction && linkedTransaction.id === linkedTransactionId)
      setFormMode({ kind: "edit", transaction: linkedTransaction });
    else toast.error("Операция недоступна: её нет или у вас нет к ней доступа");
  }, [linkedTransaction, linkedTransactionId]);

  const closeForm = () => {
    setFormMode({ kind: "closed" });
    if (linkedId) {
      openedLinkedId.current = null;
      const params = new URLSearchParams(searchParams.toString());
      params.delete("id");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  };

  const transferBlocked = activeAccounts.length < 2;
  // Новая операция берёт счёт из текущих условий: выбранный в фильтре или
  // первый счёт выбранного юрлица.
  const preferredAccountId =
    filters.bank_account_ids?.find((id) => activeAccounts.some((a) => a.id === id)) ??
    (effectiveLegalEntityId
      ? activeAccounts.find((a) => a.legal_entity_id === effectiveLegalEntityId)?.id
      : undefined);
  const openCreate = (type: TransactionRow["type"]) => setFormMode({ kind: "create", type });

  // «Добавить операцию» на дашборде ведёт сюда с `?create=<тип>`. Форма
  // открывается один раз, параметр сразу убирается из адреса — иначе
  // обновление страницы или «Назад» открывали бы её снова.
  const createFromUrl = searchParams.get("create");
  const handledCreate = useRef<string | null>(null);
  useEffect(() => {
    if (!createFromUrl) {
      handledCreate.current = null;
      return;
    }
    if (handledCreate.current === createFromUrl) return;
    handledCreate.current = createFromUrl;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("create");
    const qs = params.toString();
    // Без запроса к серверу: router.replace перерисовал бы список второй раз.
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    if (!permissions.create) return;
    if (createFromUrl !== "income" && createFromUrl !== "expense" && createFromUrl !== "transfer")
      return;
    if (createFromUrl === "transfer" && transferBlocked) {
      toast.error("Для перевода нужно хотя бы два счёта");
      return;
    }
    setFormMode({ kind: "create", type: createFromUrl });
  }, [createFromUrl, permissions.create, transferBlocked, searchParams, pathname]);
  const openCopy = (tx: TransactionRow) =>
    setFormMode({ kind: "create", type: tx.type, copyOf: tx });

  // «Сделать повторяющейся»: панель шаблона, заполненная по операции.
  const [recurringMode, setRecurringMode] = useState<RecurringFormMode>({ kind: "closed" });

  // ─── Массовая правка ──────────────────────────────────────────────────────

  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const canEditAny = permissions.updateAny || permissions.updateOwn;

  // ─── Удаление и восстановление ────────────────────────────────────────────

  const [deleteTarget, setDeleteTarget] = useState<TransactionRow[] | null>(null);
  // Выбранные, связанные с зарплатой: их удаляет (отменяет) только «Зарплата».
  const [deleteSkippedLocked, setDeleteSkippedLocked] = useState(0);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const restoreMany = async (ids: string[]) => {
    let failed = 0;
    let lastError = "";
    for (const id of ids) {
      const { error } = await restoreTransaction(id);
      if (error) {
        failed++;
        lastError = error;
      }
    }
    if (failed === ids.length) toast.error(lastError || "Не удалось восстановить");
    else if (failed > 0)
      toast.error(`Восстановлено ${ids.length - failed} из ${ids.length}. ${lastError}`);
    else
      toast.success(
        ids.length === 1
          ? "Операция восстановлена"
          : `Восстановлено: ${countRu(ids.length, "операция", "операции", "операций")}`,
      );
    setRowSelection({});
    router.refresh();
  };

  const notifyDeleted = (ids: string[]) =>
    toast(
      ids.length === 1
        ? "Операция удалена"
        : `Удалено: ${countRu(ids.length, "операция", "операции", "операций")}`,
      {
        duration: UNDO_WINDOW_MS,
        action: { label: "Отменить", onClick: () => void restoreMany(ids) },
      },
    );

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    const done: string[] = [];
    let lastError = "";
    for (const tx of deleteTarget) {
      const { error } = await softDeleteTransaction(tx.id).catch(() => ({
        error: "Нет связи с сервером. Проверьте соединение и повторите",
      }));
      if (error) lastError = error;
      else done.push(tx.id);
    }
    setDeleteBusy(false);
    if (done.length === 0) {
      setDeleteError(lastError || "Не удалось удалить");
      return;
    }
    if (done.length < deleteTarget.length) {
      // Часть удалилась: остальное оставляем в диалоге с причиной.
      setDeleteTarget(deleteTarget.filter((tx) => !done.includes(tx.id)));
      setDeleteError(
        `Удалено ${done.length} из ${done.length + deleteTarget.length - done.length}. Остальные: ${lastError}`,
      );
      router.refresh();
      return;
    }
    setDeleteTarget(null);
    setRowSelection({});
    notifyDeleted(done);
    router.refresh();
  };

  // ─── Выгрузка ─────────────────────────────────────────────────────────────

  const [exporting, setExporting] = useState(false);
  const runExport = async () => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of ["page", "size", "id", "date_preset"]) params.delete(key);
    setExporting(true);
    try {
      const response = await fetch(`/api/finance/transactions/export?${params.toString()}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error(body?.error ?? "Не удалось выгрузить операции. Повторите позже");
        return;
      }
      const blob = await response.blob();
      const name =
        /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ??
        "transactions.csv";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Нет связи с сервером. Проверьте соединение и повторите");
    } finally {
      setExporting(false);
    }
  };

  // ─── Таблица ──────────────────────────────────────────────────────────────

  const st = useTableState({ tableId: "finance.transactions", columns: columnConfig });

  const rowMenu = (tx: TransactionRow): TableRowMenuAction[] => {
    if (tx.deleted_at)
      return permissions.delete
        ? [{ label: "Восстановить", icon: <RotateCcw />, onSelect: () => void restoreMany([tx.id]) }]
        : [];
    return [
      ...(permissions.create && !(tx.type === "transfer" && transferBlocked)
        ? [{ label: "Копировать", icon: <Copy />, onSelect: () => openCopy(tx) }]
        : []),
      ...(permissions.create && tx.type !== "transfer"
        ? [
            {
              label: "Сделать повторяющейся",
              icon: <Repeat />,
              onSelect: () => setRecurringMode({ kind: "create", from: tx }),
            },
          ]
        : []),
      ...(permissions.delete && !transactionLock(tx)
        ? [
            {
              label: "Удалить",
              icon: <Trash2 />,
              destructive: true,
              separatorBefore: permissions.create,
              onSelect: () => {
                setDeleteError(null);
                setDeleteSkippedLocked(0);
                setDeleteTarget([tx]);
              },
            },
          ]
        : []),
    ];
  };
  const hasMenu = deletedMode ? permissions.delete : permissions.create || permissions.delete;

  const columns: ColumnDef<ListRow>[] = [
    {
      id: "select",
      size: 44,
      minSize: 44,
      maxSize: 44,
      enableHiding: false,
      enableResizing: false,
      enableSorting: false,
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(v === true)}
          aria-label={`Выбрать операцию от ${formatDateCell(row.original.date, timeZone)}`}
          className="align-middle"
        />
      ),
    },
    {
      id: "date",
      header: labels.date,
      size: 120,
      minSize: 100,
      enableHiding: false,
      cell: ({ row }) => (
        // Настоящая кнопка в первой ячейке: строку можно открыть с клавиатуры.
        <button
          type="button"
          className="tabular-nums hover:underline"
          onClick={() => setFormMode({ kind: "edit", transaction: row.original })}
        >
          {formatDateCell(row.original.date, timeZone) ?? "—"}
        </button>
      ),
    },
    {
      id: "amount",
      header: labels.amount,
      size: 150,
      minSize: 110,
      enableHiding: false,
      cell: ({ row }) => (
        <TxAmount
          value={signedTxAmount(row.original)}
          currency={row.original.currency}
          signed={row.original.type !== "transfer"}
          scale={amountRoundingScale}
          className="font-medium"
        />
      ),
    },
    {
      id: "category",
      header: labels.category,
      size: 200,
      minSize: 110,
      cell: ({ row }) => {
        const tx = row.original;
        const category = tx.category_id ? (categoryById.get(tx.category_id) ?? null) : null;
        return <CategoryCell tx={tx} category={category} />;
      },
    },
    {
      id: "description",
      header: labels.description,
      size: 280,
      minSize: 120,
      enableSorting: false,
      cell: ({ row }) => {
        const count = row.original.attachments_count ?? 0;
        return (
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1">
              <DescriptionText text={row.original.description} />
            </span>
            {count > 0 ? (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-muted-foreground"
                data-tip={`Файлы: ${count}`}
                aria-label={`Файлов: ${count}`}
              >
                <Paperclip className="size-3.5" />
                {count > 1 ? count : null}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: "counterparty",
      header: labels.counterparty,
      size: 200,
      minSize: 130,
      cell: ({ row }) => {
        const cp = row.original.counterparty_id
          ? counterpartyById.get(row.original.counterparty_id)
          : null;
        return cp ? (
          <span className="block truncate" data-tip={cp.name}>
            {cp.name}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      id: "account",
      header: labels.account,
      size: 230,
      minSize: 110,
      cell: ({ row }) => <AccountCell tx={row.original} accountName={accountName} />,
    },
    {
      id: "venue",
      header: labels.venue,
      size: 160,
      minSize: 110,
      enableSorting: false,
      cell: ({ row }) => {
        const name = venueName(row.original.venue_id);
        return name ? (
          <span className="block truncate" data-tip={name}>
            {name}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      id: "legal_entity",
      header: labels.legal_entity,
      size: 170,
      minSize: 100,
      enableSorting: false,
      cell: ({ row }) => {
        const name = legalEntityName(row.original.legal_entity_id) ?? "—";
        return (
          <span className="block truncate" data-tip={name}>
            {name}
          </span>
        );
      },
    },
    {
      id: "source",
      header: labels.source,
      size: 130,
      minSize: 110,
      enableSorting: false,
      cell: ({ row }) => SOURCE_LABEL[row.original.source] ?? row.original.source,
    },
    {
      id: "number",
      header: labels.number,
      size: 100,
      minSize: 90,
      enableSorting: false,
      cell: ({ row }) => <span className="tabular-nums">{row.original.public_id}</span>,
    },
    {
      id: "created",
      header: labels.created,
      size: 120,
      minSize: 100,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="tabular-nums">{formatDateCell(row.original.created_at) ?? "—"}</span>
      ),
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
              const menu = rowMenu(row.original);
              return menu.length ? <TableRowMenu actions={menu} /> : null;
            },
          } satisfies ColumnDef<ListRow>,
        ]
      : []),
  ];

  const table = useReactTable({
    data: rows,
    columns,
    state: {
      sorting,
      rowSelection,
      columnVisibility: {
        ...st.columnVisibility,
        date: true,
        amount: true,
        actions: hasMenu,
      },
      columnOrder: ["select", ...st.columnOrder],
      columnSizing: st.columnSizing,
    },
    getRowId: (tx) => tx.id,
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: st.setColumnVisibility,
    onColumnSizingChange: st.setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    rowCount: result.total,
  });

  // ─── Счётчик, итоги, пустые состояния ─────────────────────────────────────

  const sectionTotal = deletedMode ? result.deletedTotal : result.allTotal;
  const count = isFiltered ? `${result.total} из ${sectionTotal}` : sectionTotal;
  const net = result.income - result.expense;
  const mixedCurrency = result.currencies.length > 1;
  const totalCurrency = result.currencies[0] ?? "RUB";

  // Расшифровка — только когда есть и приход, и расход: иначе итог и есть она.
  // Ставится в самый широкий видимый текстовый столбец.
  const breakdownColumn = (["description", "category", "counterparty", "account"] as const).find(
    (id) => st.columnVisibility[id] !== false,
  );
  const totals: Partial<Record<string, ReactNode>> = {
    select: "",
    date: (
      <span
        data-tip="По всем операциям с учётом условий, не только на этой странице"
        data-tip-sub="Переводы между счетами в итог не входят"
      >
        Итого
      </span>
    ),
    amount: mixedCurrency ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <TxAmount
        value={net}
        currency={totalCurrency}
        signed
        scale={amountRoundingScale}
        className="font-medium"
      />
    ),
  };
  if (breakdownColumn && mixedCurrency)
    // Недостоверную сумму не показываем: прочерк и причина текстом.
    totals[breakdownColumn] = (
      <span className="block truncate text-muted-foreground">
        Счета в разных валютах: итог не сложить. Отберите один счёт или валюту
      </span>
    );
  else if (breakdownColumn && result.income > 0 && result.expense > 0)
    totals[breakdownColumn] = (
      <span className="block truncate text-muted-foreground">
        Приход +{formatAmount(result.income, amountRoundingScale)} {currencySymbol(totalCurrency)} · Расход −
        {formatAmount(result.expense, amountRoundingScale)} {currencySymbol(totalCurrency)}
      </span>
    );

  const toggleDeleted = () => {
    setRowSelection({});
    updateUrl({ deleted: deletedMode ? null : "1" });
  };

  const createMenu = permissions.create && !deletedMode && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="h-8 gap-1.5 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm">
          <Plus className="size-4" />
          Добавить операцию
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* Те же пункты, что у «Добавить операцию» на дашборде. */}
        {TRANSACTION_CREATE_OPTIONS.map(({ type, label, icon: Icon, tone }) => {
          const blocked = type === "transfer" && transferBlocked;
          return (
            <DropdownMenuItem
              key={type}
              className="gap-2"
              disabled={blocked}
              onSelect={() => openCreate(type)}
            >
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-md", tone)}>
                <Icon className="size-3.5" />
              </span>
              <span className="flex flex-col">
                {label}
                {blocked ? (
                  <span className="text-xs text-muted-foreground">Нужно хотя бы два счёта</span>
                ) : null}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <PageFrame className="flex min-w-0 flex-col gap-4">
      <Breadcrumbs items={[{ label: "Финансы" }, { label: "Транзакции" }]} />
      <InboxPlaque count={inboxCount} />
      <TablePageHeader
        title={deletedMode ? "Удалённые операции" : "Транзакции"}
        count={count}
        actions={
          <TableControls
            search={{
              value: searchDraft,
              onChange: setSearchDraft,
              open: searchOpen,
              onOpenChange: setSearchOpen,
              placeholder: "Описание, контрагент, сумма",
            }}
            filters={{ active: hasFilters, onClick: () => setFiltersOpen((v) => !v) }}
            sort={{
              active: sorting.length > 0,
              content: (
                <TableSortPicker
                  sorting={sorting}
                  onChange={changeSorting}
                  fields={sortFields}
                  labels={labels}
                />
              ),
            }}
            columns={{
              // Подсветка — когда спрятан столбец, который виден по умолчанию.
              active: columnConfig.some(
                (c) => c.defaultVisible !== false && st.columnVisibility[c.id] === false,
              ),
              content: (
                <TableColumnManager
                  columns={st.columnOrder
                    .filter((id) => id !== "actions")
                    .map((id) => {
                      const column = table.getColumn(id);
                      return {
                        id,
                        label: labels[id as ColKey],
                        visible: column?.getIsVisible() ?? false,
                        canHide: column?.getCanHide() ?? false,
                      };
                    })}
                  onVisibilityChange={(id, visible) => table.getColumn(id)?.toggleVisibility(visible)}
                  onMoveColumn={(from, to) =>
                    st.setColumnOrder((order) =>
                      arrayMove(order, order.indexOf(from), order.indexOf(to)),
                    )
                  }
                  onReset={st.resetColumns}
                />
              ),
            }}
            secondaryActions={
              <>
                {permissions.delete && (result.deletedTotal > 0 || deletedMode) ? (
                  <TableIconButton
                    label={
                      deletedMode
                        ? "Вернуться к операциям"
                        : `Удалённые операции · ${result.deletedTotal}`
                    }
                    active={deletedMode}
                    onClick={toggleDeleted}
                  >
                    <Trash2 />
                  </TableIconButton>
                ) : null}
                {permissions.export ? (
                  <TableIconButton
                    label={exporting ? "Готовим файл…" : "Выгрузить в CSV"}
                    disabled={exporting || result.total === 0}
                    onClick={() => void runExport()}
                  >
                    {exporting ? <Loader2 className="animate-spin" /> : <Download />}
                  </TableIconButton>
                ) : null}
              </>
            }
            primaryActions={createMenu}
            summary={`Показано ${rows.length} из ${result.total}`}
          />
        }
      />

      <TableConditions
        label="Условия списка операций"
        open={filtersOpen}
        hasFilters={hasFilters}
        sorting={sorting}
        onSortingChange={changeSorting}
        sortFields={sortFields}
        sortLabels={labels}
        search={urlQ}
        onSearchClear={clearSearch}
        onReset={() => void resetConditions()}
      >
        {filtersOpen || filters.date_from || filters.date_to ? (
          <DateRangeFilter
            value={dateRange}
            presetLabel={query.datePreset}
            onChange={(next, preset) =>
              updateUrl({
                date_from: next.start ? toIsoDate(next.start) : null,
                date_to: next.end ? toIsoDate(next.end) : null,
                date_preset: preset,
              })
            }
          />
        ) : null}
        {filtersOpen || filters.type ? (
          <TableFilterChip
            label="Тип"
            value={filters.type ?? ""}
            onChange={(v) => updateUrl({ type: v || null })}
            options={[
              { value: "", label: "Все типы" },
              { value: "income", label: TYPE_LABEL.income },
              { value: "expense", label: TYPE_LABEL.expense },
              { value: "transfer", label: TYPE_LABEL.transfer },
            ]}
          />
        ) : null}
        {showLegalEntityFilter && (filtersOpen || effectiveLegalEntityId) ? (
          <TableFilterChip
            label="Юрлицо"
            value={effectiveLegalEntityId}
            onChange={(v) => void changeLegalEntity(v)}
            options={legalEntityOptions}
          />
        ) : null}
        {venues.length > 0 && (filtersOpen || filters.venue_id || filters.venue_none) ? (
          <TableFilterChip
            label="Заведение"
            value={filters.venue_none ? NO_VENUE : (filters.venue_id ?? "")}
            onChange={(v) => updateUrl({ venue_id: v || null })}
            options={venueOptions}
          />
        ) : null}
        {filtersOpen || filters.bank_account_ids?.length ? (
          <TableFilterChip
            label="Счета"
            multiple
            value={filters.bank_account_ids ?? []}
            onChange={(ids) => updateUrl({ bank_account_id: ids.length ? ids.join(",") : null })}
            options={accountOptions}
            searchPlaceholder={accountOptions.length > 8 ? "Найти счёт" : undefined}
          />
        ) : null}
        {filtersOpen || categoryValue.length ? (
          <TableFilterChip
            label="Статьи"
            multiple
            value={categoryValue}
            onChange={(ids) => {
              const { ids: real, none } = splitIds(ids, NO_CATEGORY);
              updateUrl({
                category_id: none || real.length ? [...(none ? [NO_CATEGORY] : []), ...real].join(",") : null,
              });
            }}
            options={categoryOptions}
            searchPlaceholder={categoryOptions.length > 8 ? "Найти статью" : undefined}
          />
        ) : null}
        {filtersOpen || counterpartyValue.length ? (
          <TableFilterChip
            label="Контрагенты"
            multiple
            value={counterpartyValue}
            onChange={(ids) => {
              const { ids: real, none } = splitIds(ids, NO_COUNTERPARTY);
              updateUrl({
                counterparty_id:
                  none || real.length ? [...(none ? [NO_COUNTERPARTY] : []), ...real].join(",") : null,
              });
            }}
            options={counterpartyOptions}
            searchPlaceholder={counterpartyOptions.length > 8 ? "Найти контрагента" : undefined}
          />
        ) : null}
        {filtersOpen || filters.amount_min !== undefined || filters.amount_max !== undefined ? (
          <AmountRangeFilter
            value={{ min: filters.amount_min ?? null, max: filters.amount_max ?? null }}
            onChange={(next) =>
              updateUrl({
                amount_min: next.min !== null ? String(next.min) : null,
                amount_max: next.max !== null ? String(next.max) : null,
              })
            }
          />
        ) : null}
        {permissions.viewAttachments && (filtersOpen || filters.files) ? (
          <TableFilterChip
            label="Файлы"
            value={filters.files ?? ""}
            onChange={(v) => updateUrl({ files: v || null })}
            options={[
              { value: "", label: "Все операции" },
              { value: "with", label: "С файлами" },
              { value: "without", label: "Без файлов" },
            ]}
          />
        ) : null}
      </TableConditions>

      {result.error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"
        >
          <p className="min-w-0 flex-1">Не удалось загрузить операции. Проверьте соединение и повторите</p>
          <Button variant="outline" size="sm" className="h-8" onClick={() => router.refresh()}>
            Повторить
          </Button>
        </div>
      ) : rows.length === 0 ? (
        deletedMode && !isFiltered ? (
          <EmptyState
            icon={Trash2}
            title="Удалённых операций нет"
            description="Сюда попадают удалённые операции: их можно восстановить"
            action={
              <Button variant="outline" onClick={toggleDeleted}>
                К операциям
              </Button>
            }
          />
        ) : !isFiltered ? (
          <EmptyState
            icon={Wallet}
            title="Операций пока нет"
            description={
              permissions.create
                ? "Добавьте первый приход, расход или перевод между счетами"
                : "Здесь появятся приходы, расходы и переводы между счетами"
            }
            action={
              permissions.create ? (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button variant="outline" onClick={() => openCreate("income")}>
                    <Plus className="text-green-700 dark:text-green-400" />
                    Добавить приход
                  </Button>
                  <Button variant="outline" onClick={() => openCreate("expense")}>
                    <Minus className="text-red-700 dark:text-red-400" />
                    Добавить расход
                  </Button>
                </div>
              ) : null
            }
          />
        ) : (
          <EmptyState
            icon={SearchX}
            title="Операции не найдены"
            description="Измените условия поиска или сбросьте фильтры"
            action={
              <Button variant="outline" onClick={() => void resetConditions()}>
                Очистить все
              </Button>
            }
          />
        )
      ) : (
        <div className={cn("flex flex-col gap-4 transition-opacity", isPending && "opacity-60")}>
          <DataTable
            table={table}
            label={deletedMode ? "Удалённые операции" : "Операции"}
            labels={labels}
            onColumnSizingChange={st.setColumnSizing}
            sorting={sorting}
            onSortingChange={changeSorting}
            sortable={sortFields}
            numeric={["amount"]}
            renderControlHeader={(header) =>
              header.column.id === "select" ? (
                <Checkbox
                  checked={
                    table.getIsAllPageRowsSelected() ||
                    (table.getIsSomePageRowsSelected() && "indeterminate")
                  }
                  onCheckedChange={(v) => table.toggleAllPageRowsSelected(v === true)}
                  aria-label="Выбрать все операции на странице"
                  className="align-middle"
                />
              ) : null
            }
            onRowClick={(row) => setFormMode({ kind: "edit", transaction: row.original })}
            empty={null}
            totals={totals}
            mobile={{
              label: "Карточки операций",
              nameColumn: "amount",
              roleColumn: "category",
              actionsPlacement: "footer",
            }}
          />
          <TablePagination
            pageIndex={query.page - 1}
            pageSize={query.pageSize}
            total={result.total}
            onPageChange={(pageIndex) => updateUrl({ page: pageIndex > 0 ? String(pageIndex + 1) : null })}
            onPageSizeChange={(size) => updateUrl({ size: String(size), page: null })}
          />
        </div>
      )}

      <TableBulkBar
        floating
        selectedCount={selected.length}
        onClear={() => setRowSelection({})}
        summary={
          <span className="truncate text-sm text-muted-foreground">
            {selectedMixedCurrency
              ? "Счета в разных валютах: сумму не сложить"
              : [
                  selectedIncome
                    ? `Приход +${formatAmount(selectedIncome, amountRoundingScale)} ${currencySymbol(selected[0]?.currency)}`
                    : null,
                  selectedExpense
                    ? `Расход −${formatAmount(selectedExpense, amountRoundingScale)} ${currencySymbol(selected[0]?.currency)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </span>
        }
        actions={
          permissions.delete ? (
            deletedMode ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => void restoreMany(selected.map((tx) => tx.id))}
              >
                <RotateCcw />
                Восстановить · {selected.length}
              </Button>
            ) : (
              <>
                {canEditAny ? (
                  <Button variant="outline" size="sm" className="h-8" onClick={() => setBulkEditOpen(true)}>
                    <PencilLine />
                    Изменить · {selected.length}
                  </Button>
                ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  const deletable = selected.filter((tx) => !transactionLock(tx));
                  if (deletable.length === 0) {
                    toast.error(
                      "Выбранные операции связаны с зарплатой. Отменить их можно в разделе «Зарплата»",
                    );
                    return;
                  }
                  setDeleteError(null);
                  setDeleteSkippedLocked(selected.length - deletable.length);
                  setDeleteTarget(deletable);
                }}
              >
                <Trash2 />
                Удалить · {selected.length}
              </Button>
              </>
            )
          ) : canEditAny && !deletedMode ? (
            <Button variant="outline" size="sm" className="h-8" onClick={() => setBulkEditOpen(true)}>
              <PencilLine />
              Изменить · {selected.length}
            </Button>
          ) : null
        }
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleteTarget(null);
        }}
        title={
          deleteTarget && deleteTarget.length > 1
            ? `Удалить ${countRu(deleteTarget.length, "операцию", "операции", "операций")}?`
            : deleteTarget?.[0]
              ? `Удалить операцию №${deleteTarget[0].public_id}?`
              : "Удалить операцию?"
        }
        description={
          <>
            {deleteTarget && deleteTarget.length > 1
              ? "Операции пропадут из списка, а остатки счетов пересчитаются. "
              : "Операция пропадёт из списка, а остаток счёта пересчитается. "}
            Вернуть можно сразу кнопкой «Отменить» или позже из «Удалённых операций».
            {deleteSkippedLocked > 0
              ? ` Связанные с зарплатой (${deleteSkippedLocked}) не удалятся: их отменяют в разделе «Зарплата».`
              : null}
          </>
        }
        confirmLabel={
          deleteTarget && deleteTarget.length > 1
            ? `Удалить ${countRu(deleteTarget.length, "операцию", "операции", "операций")}`
            : "Удалить операцию"
        }
        pendingLabel="Удаляем…"
        destructive
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
      />

      <BulkEditDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        selected={selected}
        editable={selected.filter((tx) => canEditTransaction(tx, permissions, currentUserId))}
        categories={categories}
        counterparties={counterparties}
        venues={formVenues}
        onDone={() => {
          setBulkEditOpen(false);
          setRowSelection({});
          router.refresh();
        }}
      />

      <RecurringFormSheet
        mode={recurringMode}
        onClose={() => setRecurringMode({ kind: "closed" })}
        onSaved={() => {
          setRecurringMode({ kind: "closed" });
          toast.success("Повторяющийся платёж создан", {
            action: { label: "Открыть", onClick: () => router.push("/finance/recurring") },
          });
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

      <TransactionFormSheet
        mode={formMode}
        onClose={closeForm}
        onSaved={() => {
          closeForm();
          router.refresh();
        }}
        onDeleted={(tx) => {
          closeForm();
          notifyDeleted([tx.id]);
          router.refresh();
        }}
        onRestored={() => {
          closeForm();
          router.refresh();
        }}
        onModeChange={setFormMode}
        legalEntities={legalEntities}
        bankAccounts={activeAccounts}
        allBankAccounts={bankAccounts}
        preferredAccountId={preferredAccountId}
        venues={formVenues}
        allVenues={venues}
        preferredVenueId={formVenues.some((v) => v.id === filters.venue_id) ? filters.venue_id : undefined}
        onFilesChanged={() => router.refresh()}
        categories={categories}
        counterparties={counterparties}
        permissions={permissions}
        currentUserId={currentUserId}
        amountRoundingScale={amountRoundingScale}
        postingRules={postingRules}
        postingRuleArchivedIds={postingRuleArchivedIds}
        dadataEnabled={dadataEnabled}
        timeZone={timeZone}
      />
    </PageFrame>
  );
}

// ─── Даты ─────────────────────────────────────────────────────────────────────

/** `YYYY-MM-DD` → локальная полночь (не UTC: западнее Москвы день съехал бы). */
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
