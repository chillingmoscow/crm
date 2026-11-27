"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import {
  AlertTriangle,
  Loader2,
  Plus,
  RefreshCw,
  Search as SearchIcon,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/ui/status-badge";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { CreateActDrawer } from "./create-act-drawer";
import { PageFrame } from "@/components/shared/page-frame";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range-filter";
import {
  INVENTORY_STATUS_LABEL,
  InventoryStatusBadge,
} from "@/components/shared/inventory-status-badge";
import {
  DataTable,
  ROW_MENU_COLUMN_SIZE,
  TableBulkBar,
  TableColumnManager,
  TableConditions,
  TableControls,
  TableFilterChip,
  TablePageHeader,
  TablePagination,
  TableSortPicker,
  TableSplitButton,
  useTableState,
  type TableStateColumn,
} from "@/components/shared/table";
import { cn } from "@/lib/utils";
import { formatDateCell } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import {
  formatSignedMoney,
  signedAmountClass,
  type AmountRoundingScale,
} from "@/lib/format/amount";
import {
  getAssigneeLockReason,
  isBulkDeletable,
  getReviewerLockReason,
  hasCountedResults,
} from "@/lib/inventory/act-status";
import { ACT_CREATING_LOCK_REASON, isActCreationActive } from "@/lib/inventory/act-creation-job";
import { ActCreationStatus } from "./act-creation-status";
import { bulkAssignInventoryDocuments } from "@/app/(dashboard)/inventory/_actions/assignment";
import { bulkDeleteInventoryDocuments } from "@/app/(dashboard)/inventory/_actions/documents";
import { syncQuickRestoInventory } from "@/app/(dashboard)/inventory/_actions/sync";
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  DOCUMENT_STATUSES,
  type DocumentListRow,
  type DocumentSortMode,
  type ListDocumentsFilters,
  type ListDocumentsResult,
  type RecountFilter,
  RECOUNT_FILTER_LABEL,
} from "@/lib/inventory/list-documents-shared";

import {
  filterEligibleOptions,
  type InventoryAssignRole,
  type InventoryAssignmentEligibility,
} from "@/lib/inventory/act-assignment";
import { AssigneeSelect, type AssigneeOption } from "./assignee-select";
import { ReviewerSelect } from "./reviewer-select";
import {
  SORTABLE_COLUMNS,
  getDocHref,
  actTimeZones,
  groupsByDate,
  netResultsTotal,
  sortModesToSorting,
  sortingToSortModes,
  toIsoDate,
  type StoreOption,
  type VenueOption,
} from "./documents-table-utils";
import {
  BulkAssignMenu,
  DocumentDateGroupHeader,
  DocumentRowMenu,
  DocumentsEmptyState,
  ReadonlyPersonCell,
} from "./documents-table-rows";

export type { StoreOption, VenueOption } from "./documents-table-utils";

// ─── Constants ───────────────────────────────────────────────────────────────

const SEARCH_DEBOUNCE_MS = 250;
/** Окно склейки realtime-событий: синхронизация меняет акты пачкой. */
// Акт, в который ещё досылаются позиции, не назначают и не удаляют.
const creating = (row: DocumentListRow) => isActCreationActive(row.creation);
const assigneeLock = (row: DocumentListRow) =>
  creating(row) ? ACT_CREATING_LOCK_REASON : getAssigneeLockReason(row.status);
const reviewerLock = (row: DocumentListRow) =>
  creating(row) ? ACT_CREATING_LOCK_REASON : getReviewerLockReason(row.status);

const REALTIME_REFRESH_DELAY_MS = 400;
/** Как часто перечитывать список, пока какой-то акт создаётся. */
const CREATION_REFRESH_MS = 4000;
// v2: служебные столбцы (выбор, «⋯») больше не хранятся в настройках, а
// ширины по умолчанию пересчитаны под общий каркас — старые сохранённые
// ширины сжимали «Номер» до многоточия.
const TABLE_ID = "documents.list.v2";

/** Подписи столбцов: шапка, «Столбцы», сортировка, поля карточек на телефоне. */
const LABELS: Record<string, string> = {
  document_number: "Номер",
  invoice_date: "Дата",
  status: "Статус",
  store_title: "Склад",
  comment: "Комментарий",
  results: "Итоги",
  qr_results: "Сумма в Quick Resto",
  assigned_to: "Исполнитель",
  reviewer_id: "Проверяющий",
};

/**
 * Столбцы данных: ширина по умолчанию и минимум не уже заголовка
 * (design-system § «Ширина столбца не уже его заголовка»).
 */
const DATA_COLUMNS: Array<{ id: string; size: number; min: number; hidden?: boolean; fixed?: boolean }> = [
  { id: "document_number", size: 150, min: 120, fixed: true },
  { id: "invoice_date", size: 110, min: 96 },
  { id: "status", size: 190, min: 120 },
  { id: "store_title", size: 160, min: 96 },
  { id: "comment", size: 200, min: 120 },
  { id: "results", size: 130, min: 96 },
  // По умолчанию скрыт: это другая метрика, чем «Итоги» (см. ячейку).
  { id: "qr_results", size: 170, min: 150, hidden: true },
  { id: "assigned_to", size: 180, min: 116 },
  { id: "reviewer_id", size: 180, min: 116 },
];

const STATE_COLUMNS: TableStateColumn[] = DATA_COLUMNS.map((column) => ({
  id: column.id,
  defaultSize: column.size,
  defaultVisible: !column.hidden,
}));

const NUMERIC_COLUMNS = ["results", "qr_results"];
const SORTABLE = new Set(SORTABLE_COLUMNS);

const STATUS_OPTIONS = DOCUMENT_STATUSES.map((status) => ({
  value: status,
  label: INVENTORY_STATUS_LABEL[status] ?? status,
}));

const RECOUNT_OPTIONS = (["only", "exclude"] as const).map((value) => ({
  value,
  label: RECOUNT_FILTER_LABEL[value],
}));

// ─── Props ───────────────────────────────────────────────────────────────────

type Props = {
  initial: ListDocumentsResult;
  /** Всего актов без условий — для счётчика «N из M» в шапке. */
  unfilteredTotal: number;
  filtersFromUrl: ListDocumentsFilters;
  sortFromUrl: DocumentSortMode[];
  pageFromUrl: number;
  pageSizeFromUrl: number;
  datePresetFromUrl: string | null;
  venues: VenueOption[];
  stores: StoreOption[];
  /** Справочник имён (id → ФИО) для всех ячеек и фильтров. */
  staff: AssigneeOption[];
  /** Кого можно назначать исполнителем/проверяющим, по заведениям. null —
   *  пользователь не назначает (пикеров нет). */
  eligibility: InventoryAssignmentEligibility | null;
  accountId: string;
  canManage: boolean;
  canSync: boolean;
  canViewResults: boolean;
  /** Доступ к разделу «Сотрудники» (people.view_staff) → исполнитель/
   *  проверяющий завершённого акта становятся ссылкой на страницу сотрудника. */
  canViewStaff: boolean;
  amountRoundingScale: AmountRoundingScale;
};

// ─── Component ───────────────────────────────────────────────────────────────

export function DocumentsTable({
  initial,
  unfilteredTotal,
  filtersFromUrl,
  sortFromUrl,
  pageFromUrl,
  pageSizeFromUrl,
  datePresetFromUrl,
  venues,
  stores,
  staff,
  eligibility,
  accountId,
  canManage,
  canSync,
  canViewResults,
  canViewStaff,
  amountRoundingScale,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(filtersFromUrl.q ?? "");
  const [searchOpen, setSearchOpen] = useState(Boolean(filtersFromUrl.q));
  // Ряд условий по умолчанию свёрнут, раскрывается кнопкой фильтров.
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [isSyncing, startSyncTransition] = useTransition();
  // Клавиатурная навигация (J/K/Enter, «/» — поиск, F — фильтры).
  const [focusedIndex, setFocusedIndex] = useState(-1);
  // Выделение (только для менеджера): массово назначить или удалить.
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [bulkPending, startBulk] = useTransition();
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // ── URL sync ───────────────────────────────────────────────
  const updateUrl = useCallback(
    (
      patch: Record<string, string | string[] | null | undefined>,
      opts: { resetPage?: boolean; mode?: "push" | "replace" } = {},
    ) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === "") {
          next.delete(key);
        } else if (Array.isArray(value)) {
          if (value.length === 0) next.delete(key);
          else next.set(key, value.join(","));
        } else {
          next.set(key, value);
        }
      }
      if (opts.resetPage) next.delete("page");
      const qs = next.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (opts.mode === "push") router.push(url);
      else router.replace(url);
    },
    [pathname, router, searchParams],
  );

  // Debounced search → URL.
  //
  // Внутри таймаута читаем URL не из closure (через updateUrl ⇄
  // searchParams), а из window.location.search. Иначе при гонке —
  // пользователь печатает поиск + параллельно кликает фильтр —
  // pending-таймаут писал бы старый снимок URL и затирал недавнее
  // изменение фильтра. См. Codex P1 #394.
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (search === (filtersFromUrl.q ?? "")) return;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      const trimmed = search.trim();
      const params = new URLSearchParams(window.location.search);
      if (trimmed.length >= 2) params.set("q", trimmed);
      else params.delete("q");
      params.delete("page");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // ── Ход фонового создания актов ────────────────────────────
  // Задание пишет ход в свою таблицу, realtime по актам его не видит —
  // пока какой-то акт на странице создаётся, перечитываем список.
  const anyCreating = initial.rows.some((row) => isActCreationActive(row.creation));
  useEffect(() => {
    if (!anyCreating) return;
    const timer = window.setInterval(() => router.refresh(), CREATION_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [anyCreating, router]);

  // ── Realtime ───────────────────────────────────────────────
  // Синхронизация обновляет акты пачкой: 20 актов = 20 событий подряд, и
  // каждое дёргало router.refresh() — полный ре-рендер серверного дерева со
  // всеми запросами списка. Коалесцируем всплеск в одно обновление.
  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        router.refresh();
      }, REALTIME_REFRESH_DELAY_MS);
    };
    const channel = supabase
      .channel(`documents-${accountId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "documents", filter: `account_id=eq.${accountId}` },
        scheduleRefresh,
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [accountId, router]);

  // ── Keyboard shortcuts ─────────────────────────────────────
  // J/K — навигация по строкам, Enter — открыть, / — поиск, F — фильтры.
  // Не перехватываем клавиши, когда фокус на интерактивном контроле:
  // нативные поля, contenteditable, кнопки, ссылки, Radix-меню и диалоги —
  // иначе Enter «открыл бы акт» вместо активации контрола (Codex P1 #406).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const interactive =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable ||
          !!el.closest(
            'button, a[href], [role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [role="combobox"], [role="dialog"]',
          ));
      if (interactive || e.metaKey || e.ctrlKey || e.altKey) return;
      const rows = initial.rows;
      const lastIndex = rows.length - 1;
      if (e.key === "/") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        setFocusedIndex((i) => (i < 0 ? 0 : Math.min(lastIndex, i + 1)));
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        setFocusedIndex((i) => (i < 0 ? 0 : Math.max(0, i - 1)));
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setFiltersVisible((v) => !v);
      } else if (e.key === "Enter") {
        if (focusedIndex >= 0 && focusedIndex <= lastIndex) {
          e.preventDefault();
          router.push(getDocHref(rows[focusedIndex], canViewResults));
        }
      } else if (e.key === "Escape") {
        setFocusedIndex(-1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [initial.rows, focusedIndex, canViewResults, router]);

  // Подскролл к выделенной клавиатурой строке.
  useEffect(() => {
    if (focusedIndex < 0) return;
    document
      .querySelectorAll<HTMLTableRowElement>('table[aria-label="Акты инвентаризации"] tbody tr')
      [focusedIndex]?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex]);

  // ── Bulk-выделение ─────────────────────────────────────────
  // Выделять можно ЛЮБУЮ строку страницы — это нужно для подсчёта суммы
  // итогов по выделению (включая проведённые акты). Массовые ДЕЙСТВИЯ
  // показываются по-кнопочно, только когда ВСЕ выделенные акты подходят
  // для конкретного действия — без частичного применения.
  //
  // Выделение хранит id; строки, исчезнувшие после realtime/refresh, в
  // расчёт не попадают — список строится от текущих строк страницы.
  const selectedRowsList = useMemo(
    () => initial.rows.filter((row) => rowSelection[row.id]),
    [initial.rows, rowSelection],
  );

  // Пикеры предлагают только тех, у кого есть право на роль в заведении акта.
  // Массовое меню — объединение по заведениям выбранных актов: акты, где у
  // человека права нет, сервер пропустит и посчитает в «пропущено».
  const eligibleFor = useCallback(
    (role: InventoryAssignRole, venueIds: ReadonlyArray<string | null>) =>
      eligibility
        ? filterEligibleOptions({ options: staff, eligibility, role, venueIds })
        : staff,
    [eligibility, staff],
  );
  const selectedVenueIds = useMemo(
    () => Array.from(new Set(selectedRowsList.map((row) => row.venue_id))),
    [selectedRowsList],
  );

  // Сумма итогов (нетто = излишки − недостачи) по выделенным строкам.
  // Если хотя бы по одному выделенному акту итог посчитать не удалось, суммы
  // нет вовсе: частичная сумма выглядела бы как полная.
  const selectedTotals = useMemo(() => netResultsTotal(selectedRowsList), [selectedRowsList]);

  const canBulkAssignee =
    selectedRowsList.length > 0 && selectedRowsList.every((row) => assigneeLock(row) === null);
  const canBulkReviewer =
    selectedRowsList.length > 0 && selectedRowsList.every((row) => reviewerLock(row) === null);
  // Удаление шире замков назначения: его блокирует ещё и снимок итогов,
  // который переживает распроведение.
  const isDeletable = (row: DocumentListRow) =>
    !creating(row) &&
    isBulkDeletable({ status: row.status, resultsSnapshotAt: row.results_snapshot_at });
  const canBulkDelete = selectedRowsList.length > 0 && selectedRowsList.every(isDeletable);

  const clearSelection = () => setRowSelection({});

  const applyBulkAssign = (role: "assignee" | "reviewer", userId: string | null) => {
    // Шлём только строки текущей страницы, подходящие для роли.
    const ids = selectedRowsList
      .filter(
        (row) =>
          (role === "assignee" ? assigneeLock(row) : reviewerLock(row)) === null,
      )
      .map((row) => row.id);
    if (ids.length === 0) return;
    startBulk(async () => {
      const res = await bulkAssignInventoryDocuments({ documentIds: ids, role, userId });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Обновлено: ${countRu(res.updated, "акт", "акта", "актов")}` +
          (res.skipped > 0 ? `, пропущено: ${res.skipped}` : ""),
      );
      clearSelection();
      router.refresh();
    });
  };

  const applyBulkDelete = () => {
    // Тот же замок, что решает, показывать ли кнопку.
    const ids = selectedRowsList.filter(isDeletable).map((row) => row.id);
    if (ids.length === 0) return;
    setBulkDeleteError(null);
    startBulk(async () => {
      const res = await bulkDeleteInventoryDocuments({ documentIds: ids });
      if (res.deleted === 0) {
        setBulkDeleteError(res.error ?? "Не удалось удалить акты. Попробуйте ещё раз");
        return;
      }
      // Частичный успех: часть актов удалена, часть пропущена сервером.
      // Диалог закрываем и обновляем список, причину пропуска — в тост.
      const deletedText = `Удалено: ${countRu(res.deleted, "акт", "акта", "актов")}`;
      if (res.error) toast.warning(`${deletedText}. ${res.error}`);
      else toast.success(deletedText);
      setBulkDeleteOpen(false);
      clearSelection();
      router.refresh();
    });
  };

  // ── Columns ────────────────────────────────────────────────
  const searchActive = Boolean(filtersFromUrl.q);
  const timeZoneOf = useMemo(() => actTimeZones(venues), [venues]);

  const columns = useMemo<ColumnDef<DocumentListRow>[]>(() => {
    const cells: Record<string, ColumnDef<DocumentListRow>["cell"]> = {
      document_number: ({ row }) => {
        const doc = row.original;
        return (
          <div className="min-w-0">
            <Link
              href={getDocHref(doc, canViewResults)}
              className="block truncate font-medium transition-colors duration-200 hover:text-brand"
              data-tip={`№ ${doc.document_number}`}
              data-tip-overflow
            >
              № {doc.document_number}
            </Link>
            {searchActive && doc.matched_ingredients && doc.matched_ingredients.length > 0 ? (
              // Найдено по составу акта: подсвечиваем, какие позиции совпали.
              <div className="mt-1 flex flex-wrap gap-1">
                {doc.matched_ingredients.map((name) => (
                  <StatusBadge key={name} tone="warning" icon={<SearchIcon />}>
                    {name}
                  </StatusBadge>
                ))}
              </div>
            ) : null}
          </div>
        );
      },
      invoice_date: ({ row }) => (
        <span className="tabular-nums">{formatDateCell(row.original.invoice_date, timeZoneOf(row.original.venue_id)) ?? "—"}</span>
      ),
      status: ({ row }) => {
        const doc = row.original;
        return (
          <div className="flex min-w-0 items-center gap-1.5">
            {doc.creation ? (
              <ActCreationStatus creation={doc.creation} />
            ) : (
              <InventoryStatusBadge status={doc.status} />
            )}
            {doc.recount_of_document_id ? (
              <StatusBadge tone="info" tip="Акт пересчёта: позиции вынесены из другого акта">
                Пересчёт
              </StatusBadge>
            ) : null}
            {doc.results_reopened_after_processed ? (
              <span
                className="inline-flex shrink-0 text-amber-600 dark:text-amber-400"
                role="img"
                aria-label="Итоги правились после проведения"
                data-tip="Итоги правились после проведения: суммы могут расходиться с Quick Resto"
              >
                <AlertTriangle className="h-4 w-4" />
              </span>
            ) : null}
          </div>
        );
      },
      store_title: ({ row }) => (
        <span className="block truncate" data-tip={row.original.store_title ?? undefined} data-tip-overflow>
          {row.original.store_title ?? "—"}
        </span>
      ),
      comment: ({ row }) => (
        <span
          className="block truncate text-muted-foreground"
          data-tip={row.original.comment ?? undefined}
          data-tip-overflow
        >
          {row.original.comment ?? "—"}
        </span>
      ),
      // Одно число — нетто-расхождение (излишки − недостачи).
      results: ({ row }) => {
        const doc = row.original;
        // Прочерк и у актов без построчных расчётов, и у тех, что ещё не
        // сдали: у вторых Quick Resto отдаёт разницу, равную минус складскому
        // остатку, и «0 ₽» читалось бы как «посчитано, расхождений нет».
        if (!doc.results_has_line_amounts || !hasCountedResults(doc.status)) {
          return <span className="text-muted-foreground">—</span>;
        }
        // Итоги не посчитались: прочерк, а не 0 ₽ — иначе акт с
        // расхождением выглядит сошедшимся.
        if (doc.totals_unavailable) {
          return (
            <span className="text-muted-foreground" data-tip="Не удалось посчитать итоги, обновите страницу">
              —
            </span>
          );
        }
        const net = (doc.surplus_sum ?? 0) - (doc.shortfall_sum ?? 0);
        return (
          <span className={cn("whitespace-nowrap font-medium", signedAmountClass(net))}>
            {formatSignedMoney(net, "RUB", amountRoundingScale)}
          </span>
        );
      },
      // Недостача/излишек так, как их посчитал сам Quick Resto при
      // проведении (без наших исключений и пересортов). До проведения
      // Quick Resto по документу отдаёт нули, поэтому там прочерк.
      qr_results: ({ row }) => {
        const doc = row.original;
        if (doc.qr_shortfall_sum == null && doc.qr_surplus_sum == null) {
          return <span className="text-muted-foreground">—</span>;
        }
        const net = Math.abs(doc.qr_surplus_sum ?? 0) - Math.abs(doc.qr_shortfall_sum ?? 0);
        return (
          <span
            className={cn("whitespace-nowrap font-medium", signedAmountClass(net))}
            data-tip="Сумма, которую записал в акт Quick Resto при проведении. Исключения и пересорты на неё не влияют"
          >
            {formatSignedMoney(net, "RUB", amountRoundingScale)}
          </span>
        );
      },
      assigned_to: ({ row }) => {
        const doc = row.original;
        const lockReason = assigneeLock(doc);
        return canManage ? (
          <AssigneeSelect
            documentId={doc.id}
            assignedTo={doc.assigned_to}
            staff={staff}
            options={eligibleFor("assignee", [doc.venue_id])}
            blockedUserId={doc.reviewer_id}
            lockReason={lockReason}
            linkToPerson={canViewStaff}
          />
        ) : (
          <ReadonlyPersonCell
            userId={doc.assigned_to}
            staff={staff}
            locked={lockReason !== null}
            canViewStaff={canViewStaff}
          />
        );
      },
      reviewer_id: ({ row }) => {
        const doc = row.original;
        const lockReason = reviewerLock(doc);
        return canManage ? (
          <ReviewerSelect
            documentId={doc.id}
            reviewerId={doc.reviewer_id}
            staff={staff}
            options={eligibleFor("reviewer", [doc.venue_id])}
            blockedUserId={doc.assigned_to}
            lockReason={lockReason}
            linkToPerson={canViewStaff}
          />
        ) : (
          <ReadonlyPersonCell
            userId={doc.reviewer_id}
            staff={staff}
            locked={lockReason !== null}
            canViewStaff={canViewStaff}
          />
        );
      },
    };

    return [
      ...(canManage
        ? [
            {
              id: "select",
              size: 44,
              minSize: 44,
              maxSize: 44,
              enableHiding: false,
              enableResizing: false,
              cell: ({ row }) => (
                <Checkbox
                  checked={row.getIsSelected()}
                  onCheckedChange={(checked) => row.toggleSelected(checked === true)}
                  aria-label={`Выбрать акт № ${row.original.document_number}`}
                  className="align-middle"
                />
              ),
            } satisfies ColumnDef<DocumentListRow>,
          ]
        : []),
      ...DATA_COLUMNS.map(
        (column): ColumnDef<DocumentListRow> => ({
          id: column.id,
          header: LABELS[column.id],
          size: column.size,
          minSize: column.min,
          enableHiding: !column.fixed,
          cell: cells[column.id],
        }),
      ),
      {
        id: "actions",
        size: ROW_MENU_COLUMN_SIZE,
        minSize: ROW_MENU_COLUMN_SIZE,
        maxSize: ROW_MENU_COLUMN_SIZE,
        enableHiding: false,
        enableResizing: false,
        cell: ({ row }) => (
          <DocumentRowMenu doc={row.original} canManage={canManage} canViewResults={canViewResults} />
        ),
      },
    ];
  }, [amountRoundingScale, canManage, canViewResults, canViewStaff, eligibleFor, searchActive, staff, timeZoneOf]);

  const st = useTableState({ tableId: TABLE_ID, columns: STATE_COLUMNS });
  // Служебные столбцы не участвуют в порядке и видимости: раньше их
  // сохраняли в общем порядке, поэтому из старых настроек их вычищаем.
  const dataOrder = useMemo(
    () => st.columnOrder.filter((id) => id !== "select" && id !== "actions"),
    [st.columnOrder],
  );

  const sorting = useMemo<SortingState>(() => sortModesToSorting(sortFromUrl), [sortFromUrl]);
  const setSorting = (next: SortingState) => {
    const modes = sortingToSortModes(next);
    updateUrl({ sort: modes.length === 0 ? null : modes }, { resetPage: true });
  };

  const table = useReactTable({
    data: initial.rows,
    columns,
    state: {
      sorting,
      columnVisibility: {
        ...st.columnVisibility,
        document_number: true,
        select: true,
        actions: true,
      },
      columnOrder: [...(canManage ? ["select"] : []), ...dataOrder, "actions"],
      columnSizing: st.columnSizing,
      rowSelection,
    },
    getRowId: (row) => row.id,
    enableRowSelection: canManage,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: st.setColumnVisibility,
    onColumnSizingChange: st.setColumnSizing,
    // Сортировка и страницы — на сервере, по адресу.
    manualSorting: true,
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  });

  // ── Filter handlers ────────────────────────────────────────
  const onDateRangeChange = (next: DateRangeValue, presetLabel: string | null) => {
    updateUrl(
      {
        date_from: next.start ? toIsoDate(next.start) : null,
        date_to: next.end ? toIsoDate(next.end) : null,
        date_preset: presetLabel,
      },
      { resetPage: true },
    );
  };

  const onClearAll = () => {
    setSearch("");
    router.replace(pathname);
  };

  const status = filtersFromUrl.status ?? [];
  const store = filtersFromUrl.store ?? [];
  const assigned = filtersFromUrl.assigned && filtersFromUrl.assigned !== "any" ? filtersFromUrl.assigned : "";
  const reviewer = filtersFromUrl.reviewer && filtersFromUrl.reviewer !== "any" ? filtersFromUrl.reviewer : "";
  const recount: RecountFilter | "" =
    filtersFromUrl.recount && filtersFromUrl.recount !== "any" ? filtersFromUrl.recount : "";
  const venue = filtersFromUrl.venue && filtersFromUrl.venue !== "all" ? filtersFromUrl.venue : "";
  const hasDate = Boolean(filtersFromUrl.date_from || filtersFromUrl.date_to);

  const hasActiveFilters =
    Boolean(venue || assigned || reviewer || recount || hasDate) ||
    status.length > 0 ||
    store.length > 0;
  const hasSearch = Boolean(filtersFromUrl.q);
  const hasAnyActive = hasActiveFilters || hasSearch || sorting.length > 0;
  const showChip = (value: boolean) => filtersVisible || value;

  const personOptions = (me: string, none: string) => [
    { value: "me", label: me },
    { value: "none", label: none },
    ...staff.map((member) => ({ value: member.id, label: member.name })),
  ];

  // ── Sync Quick Resto ───────────────────────────────────────
  const runSync = (scope: "documents" | "full") => {
    startSyncTransition(async () => {
      try {
        const result = await syncQuickRestoInventory({ scope });
        if (result.error || !result.summary) {
          toast.error(result.error ?? "Синхронизация не выполнена");
          return;
        }
        const base =
          scope === "documents"
            ? `Синхронизировано: ${countRu(result.summary.documents, "акт", "акта", "актов")}`
            : `Синхронизировано: ${countRu(result.summary.products, "позиция", "позиции", "позиций")}, ${countRu(result.summary.documents, "акт", "акта", "актов")}`;
        // Сбойные акты и пропущенные виды не роняют проход, но и молчать о них нельзя.
        const problems = [
          ...(result.summary.failedDocuments > 0
            ? [`Не удалось обработать: ${countRu(result.summary.failedDocuments, "акт", "акта", "актов")}`]
            : []),
          ...result.summary.warnings,
        ];
        if (problems.length > 0) {
          toast.warning([base, ...problems].join(". "));
        } else {
          toast.success(base);
        }
        router.refresh();
      } catch {
        toast.error("Синхронизация не выполнена. Попробуйте ещё раз");
      }
    });
  };

  const total = initial.total;
  const showingFrom = total === 0 ? 0 : (pageFromUrl - 1) * pageSizeFromUrl + 1;
  const showingTo = Math.min(total, pageFromUrl * pageSizeFromUrl);

  const dateRange: DateRangeValue = useMemo(
    () => ({
      start: filtersFromUrl.date_from ? new Date(filtersFromUrl.date_from) : null,
      end: filtersFromUrl.date_to ? new Date(filtersFromUrl.date_to) : null,
    }),
    [filtersFromUrl.date_from, filtersFromUrl.date_to],
  );

  const selectAllCheckbox = (
    <Checkbox
      checked={
        table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")
      }
      onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked === true)}
      disabled={initial.rows.length === 0}
      aria-label="Выбрать все акты на странице"
      className="align-middle"
    />
  );

  return (
    <PageFrame className="space-y-4">
      <Breadcrumbs items={[{ label: "Документы" }, { label: "Акты инвентаризации" }]} />

      <div className="space-y-3">
        <TablePageHeader
          title="Акты инвентаризации"
          count={hasActiveFilters || hasSearch ? `${total} из ${unfilteredTotal}` : total}
          actions={
            <TableControls
              search={{
                value: search,
                onChange: setSearch,
                open: searchOpen,
                onOpenChange: setSearchOpen,
                placeholder: "Номер, комментарий или позиция",
              }}
              filters={{
                active: hasActiveFilters,
                label: filtersVisible ? "Скрыть фильтры" : "Показать фильтры",
                onClick: () => setFiltersVisible((v) => !v),
              }}
              sort={{
                active: sorting.length > 0,
                content: (
                  <TableSortPicker
                    sorting={sorting}
                    onChange={setSorting}
                    fields={SORTABLE_COLUMNS}
                    labels={LABELS}
                  />
                ),
              }}
              columns={{
                active: dataOrder.some((id) => table.getColumn(id)?.getIsVisible() === false),
                content: (
                  <TableColumnManager
                    columns={dataOrder.flatMap((id) => {
                      const column = table.getColumn(id);
                      return column
                        ? [
                            {
                              id,
                              label: LABELS[id] ?? id,
                              visible: column.getIsVisible(),
                              canHide: column.getCanHide(),
                              width: column.getSize(),
                            },
                          ]
                        : [];
                    })}
                    onVisibilityChange={(id, visible) => table.getColumn(id)?.toggleVisibility(visible)}
                    onMoveColumn={(activeId, overId) =>
                      st.setColumnOrder((current) => {
                        const oldIndex = current.indexOf(activeId);
                        const newIndex = current.indexOf(overId);
                        if (oldIndex < 0 || newIndex < 0) return current;
                        return arrayMove(current, oldIndex, newIndex);
                      })
                    }
                    onReset={st.resetColumns}
                  />
                ),
              }}
              secondaryActions={
                canManage ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-2 sm:h-9"
                    onClick={() => setCreateOpen(true)}
                  >
                    <Plus className="size-4" />
                    Создать акт
                  </Button>
                ) : null
              }
              primaryActions={
                canSync ? (
                  <TableSplitButton
                    label={isSyncing ? "Синхронизируем…" : "Синхронизировать"}
                    icon={isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    primaryTooltip="Загрузить акты из Quick Resto"
                    menuTooltip="Выбрать, что синхронизировать"
                    disabled={isSyncing}
                    onPrimaryClick={() => runSync("documents")}
                    options={[
                      { label: "Только акты", onSelect: () => runSync("documents") },
                      { label: "Акты, ингредиенты и склады", onSelect: () => runSync("full") },
                    ]}
                  />
                ) : null
              }
              summary={
                <>
                  Показано {showingFrom}–{showingTo} из {total}
                </>
              }
            />
          }
        />

        {/* Ряд условий: сортировка → фильтры → поиск → «Очистить все».
            Правила видимости — внутри TableConditions; выбранный фильтр
            виден и при свёрнутом ряде. */}
        <TableConditions
          label="Условия списка актов"
          open={filtersVisible}
          hasFilters={hasActiveFilters}
          sorting={sorting}
          onSortingChange={setSorting}
          sortFields={SORTABLE_COLUMNS}
          sortLabels={LABELS}
          search={filtersFromUrl.q}
          onSearchClear={() => setSearch("")}
          onReset={onClearAll}
        >
          {showChip(hasDate) ? (
            <DateRangeFilter
              value={dateRange}
              presetLabel={datePresetFromUrl}
              onChange={onDateRangeChange}
              ariaLabel="Период актов"
            />
          ) : null}
          {showChip(status.length > 0) ? (
            <TableFilterChip
              label="Статус"
              multiple
              value={status}
              options={STATUS_OPTIONS}
              onChange={(next) => updateUrl({ status: next }, { resetPage: true })}
            />
          ) : null}
          {canManage && showChip(Boolean(assigned)) ? (
            <TableFilterChip
              label="Исполнитель"
              value={assigned}
              options={personOptions("На меня", "Без исполнителя")}
              searchPlaceholder="Найти сотрудника"
              onChange={(next) => updateUrl({ assigned: next || null }, { resetPage: true })}
            />
          ) : null}
          {canManage && showChip(Boolean(reviewer)) ? (
            <TableFilterChip
              label="Проверяющий"
              value={reviewer}
              options={personOptions("Проверяю я", "Без проверяющего")}
              searchPlaceholder="Найти сотрудника"
              onChange={(next) => updateUrl({ reviewer: next || null }, { resetPage: true })}
            />
          ) : null}
          {stores.length > 0 && showChip(store.length > 0) ? (
            <TableFilterChip
              label="Склад"
              multiple
              value={store}
              options={stores.map((s) => ({ value: s.id, label: s.title }))}
              searchPlaceholder={stores.length > 8 ? "Найти склад" : undefined}
              onChange={(next) => updateUrl({ store: next }, { resetPage: true })}
            />
          ) : null}
          {showChip(Boolean(recount)) ? (
            <TableFilterChip
              label="Пересчёты"
              value={recount}
              options={RECOUNT_OPTIONS}
              onChange={(next) => updateUrl({ recount: next || null }, { resetPage: true })}
            />
          ) : null}
          {venues.length > 1 && showChip(Boolean(venue)) ? (
            <TableFilterChip
              label="Заведение"
              value={venue}
              options={venues.map((v) => ({ value: v.id, label: v.name }))}
              onChange={(next) => updateUrl({ venue: next || null }, { resetPage: true })}
            />
          ) : null}
        </TableConditions>
      </div>

      {initial.rows.length === 0 ? (
        <DocumentsEmptyState
          canSync={canSync}
          hasActive={hasAnyActive}
          syncing={isSyncing}
          onClearAll={onClearAll}
          onSync={() => runSync("documents")}
        />
      ) : (
        <DataTable
          table={table}
          label="Акты инвентаризации"
          labels={LABELS}
          onColumnSizingChange={st.setColumnSizing}
          sorting={sorting}
          onSortingChange={setSorting}
          sortable={SORTABLE}
          numeric={NUMERIC_COLUMNS}
          controlColumns={["select", "actions"]}
          renderControlHeader={(header) => (header.column.id === "select" ? selectAllCheckbox : null)}
          onRowClick={(row) => router.push(getDocHref(row.original, canViewResults))}
          rowClassName={(row) =>
            row.index === focusedIndex ? "bg-muted/50 ring-1 ring-inset ring-brand/40" : undefined
          }
          // Акты одной инвентаризации (одна дата, разные склады и группы) —
          // под общим подзаголовком с итогом. Только пока список идёт по дате.
          groups={
            groupsByDate(sortFromUrl)
              ? {
                  key: (doc) => formatDateCell(doc.invoice_date, timeZoneOf(doc.venue_id)) ?? "",
                  header: (docs) => (
                    <DocumentDateGroupHeader
                      docs={docs}
                      timeZone={timeZoneOf(docs[0]?.venue_id ?? null)}
                      amountRoundingScale={amountRoundingScale}
                    />
                  ),
                }
              : undefined
          }
          empty={null}
          mobile={{
            label: "Карточки актов",
            nameColumn: "document_number",
            statusColumn: "status",
            actionsPlacement: canManage ? "footer" : "header",
            selection: canManage ? (
              <label className="flex min-h-10 items-center gap-3 text-sm text-muted-foreground">
                {selectAllCheckbox}
                Выбрать все на странице
              </label>
            ) : null,
          }}
        />
      )}

      <TablePagination
        pageIndex={pageFromUrl - 1}
        pageSize={pageSizeFromUrl}
        total={total}
        onPageChange={(idx) => updateUrl({ page: String(idx + 1) }, { mode: "push" })}
        onPageSizeChange={(size) => updateUrl({ size: String(size), page: null })}
      />

      {canManage ? (
        <TableBulkBar
          selectedCount={selectedRowsList.length}
          onClear={clearSelection}
          floating
          summary={
            selectedTotals.unavailable ? (
              <span
                className="whitespace-nowrap text-sm font-medium text-muted-foreground"
                data-tip="По части выбранных актов итог посчитать не удалось, обновите страницу"
              >
                Итог: —
              </span>
            ) : (
              <span
                className={cn(
                  "whitespace-nowrap text-sm font-medium tabular-nums",
                  signedAmountClass(selectedTotals.net),
                )}
              >
                Итог: {formatSignedMoney(selectedTotals.net, "RUB", amountRoundingScale)}
              </span>
            )
          }
          actions={
            // Кнопка показывается, только когда действие применимо ко ВСЕМ
            // выбранным актам (без частичного применения).
            canBulkAssignee || canBulkReviewer || canBulkDelete ? (
              <>
                {canBulkAssignee ? (
                  <BulkAssignMenu
                    label="Исполнитель"
                    clearLabel="Снять исполнителя"
                    icon={<UserPlus className="h-4 w-4" />}
                    staff={eligibleFor("assignee", selectedVenueIds)}
                    disabled={bulkPending}
                    onPick={(userId) => applyBulkAssign("assignee", userId)}
                  />
                ) : null}
                {canBulkReviewer ? (
                  <BulkAssignMenu
                    label="Проверяющий"
                    clearLabel="Снять проверяющего"
                    icon={<ShieldCheck className="h-4 w-4" />}
                    staff={eligibleFor("reviewer", selectedVenueIds)}
                    disabled={bulkPending}
                    onPick={(userId) => applyBulkAssign("reviewer", userId)}
                  />
                ) : null}
                {canBulkDelete ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={bulkPending}
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Удалить
                  </Button>
                ) : null}
              </>
            ) : undefined
          }
        />
      ) : null}

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => {
          if (!open) setBulkDeleteError(null);
          setBulkDeleteOpen(open);
        }}
        title={`Удалить ${countRu(selectedRowsList.length, "акт", "акта", "актов")}?`}
        consequences={[
          { kind: "remove", text: "Акты и все их позиции удалятся здесь и в Quick Resto" },
          { kind: "info", text: "Акт, который Quick Resto не удалит, останется и там, и здесь" },
          { kind: "irreversible", text: "Нельзя отменить" },
        ]}
        confirmLabel={`Удалить ${countRu(selectedRowsList.length, "акт", "акта", "актов")}`}
        pendingLabel="Удаляем…"
        destructive
        busy={bulkPending}
        error={bulkDeleteError}
        onConfirm={applyBulkDelete}
      />
      {canManage ? (
        <CreateActDrawer open={createOpen} onOpenChange={setCreateOpen} staff={staff} eligibility={eligibility} />
      ) : null}
    </PageFrame>
  );
}
