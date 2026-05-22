"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Loader2,
  RefreshCw,
  Search as SearchIcon,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMoney, type AmountRoundingScale } from "@/lib/format/amount";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range-filter";
import { InventoryStatusBadge } from "@/components/shared/inventory-status-badge";
import { getAssigneeLockReason, getReviewerLockReason } from "@/lib/inventory/act-status";
import {
  TableBulkBar,
  TableColumnManager,
  TableControlPin,
  TableControls,
  TablePageHeader,
  TablePagination,
  TableSplitButton,
  useTableState,
  type ManagedTableColumn,
  type TableStateColumn,
} from "@/components/shared/table";
import {
  bulkAssignInventoryDocuments,
  bulkDeleteInventoryDocuments,
  syncQuickRestoInventory,
} from "@/app/(dashboard)/inventory/actions";
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client";

import {
  AssigneeSelect,
  type AssigneeOption,
} from "./assignee-select";
import { ReviewerSelect } from "./reviewer-select";
import {
  DEFAULT_SORT,
  isDefaultSort,
  type DocumentListRow,
  type DocumentSortMode,
  type DocumentStatus,
  type ListDocumentsFilters,
  type ListDocumentsResult,
} from "@/lib/inventory/list-documents-shared";
import {
  COLUMN_TO_FIELD,
  SORT_FIELD_LABEL,
  combineSort,
  formatDate,
  getDocHref,
  sortToDirection,
  sortToField,
  toIsoDate,
  type SortField,
  type StoreOption,
  type VenueOption,
} from "./documents-table-utils";
import {
  BulkAssignMenu,
  DesktopRowMenu,
  EmptyTableBody,
  MobileCard,
  ReadonlyPersonCell,
} from "./documents-table-rows";
import {
  AssignedPicker,
  PinDivider,
  ReviewerPicker,
  SortFieldPanel,
  SortPinEditor,
  StatusPicker,
  StorePicker,
  VenuePicker,
  assigneePinLabel,
  reviewerPinLabel,
  statusPinLabel,
  storePinLabel,
  venuePinLabel,
} from "./documents-table-filters";

export type { StoreOption, VenueOption } from "./documents-table-utils";

// ─── Constants ───────────────────────────────────────────────────────────────

const SEARCH_DEBOUNCE_MS = 250;
const TABLE_ID = "documents.list";

// ─── Props ───────────────────────────────────────────────────────────────────

type Props = {
  initial: ListDocumentsResult;
  filtersFromUrl: ListDocumentsFilters;
  sortFromUrl: DocumentSortMode[];
  pageFromUrl: number;
  pageSizeFromUrl: number;
  datePresetFromUrl: string | null;
  venues: VenueOption[];
  stores: StoreOption[];
  staff: AssigneeOption[];
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
  filtersFromUrl,
  sortFromUrl,
  pageFromUrl,
  pageSizeFromUrl,
  datePresetFromUrl,
  venues,
  stores,
  staff,
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
  // По умолчанию пины-фильтры скрыты: кнопка «Показать фильтры» —
  // нейтральная (не подсвечена). Раскрытие — явное действие.
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [isSyncing, startSyncTransition] = useTransition();
  // Клавиатурная навигация (J/K/Enter/// /F). Справка («?») — в топ-баре.
  const [focusedIndex, setFocusedIndex] = useState(-1);
  // Bulk-выделение (только для менеджера): назначить исполнителя/проверяющего.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkPending, startBulk] = useTransition();
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

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
  // пользователь печатает поиск + параллельно кликает пин фильтра —
  // pending-таймаут писал бы старый снимок URL и затирал недавнее
  // изменение фильтра. См. Codex P1 #394.
  // Включить updateUrl в deps нельзя: каждое изменение searchParams
  // тогда сбросит debounce-таймер и поиск будет «дёргаться» при
  // любой параллельной активности в URL.
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

  // ── Realtime ───────────────────────────────────────────────
  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel(`documents-${accountId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "documents", filter: `account_id=eq.${accountId}` },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [accountId, router]);

  // ── Keyboard shortcuts (Linear-style) ──────────────────────
  // J/K — навигация по строкам, Enter — открыть, / — поиск, F — фильтры,
  // ? — справка. Игнорируем, когда фокус в поле ввода (чтобы не перехватывать
  // печать). Зависит от текущего набора строк (initial.rows).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      // Не перехватываем клавиши, когда фокус на интерактивном контроле:
      // нативные поля ввода, contenteditable, А ТАКЖЕ Radix-триггеры/меню/
      // диалоги (Select исполнителя, row-menu «⋯» — это <button>/role-узлы,
      // не нативные select). Иначе Enter «открыл бы акт» вместо активации
      // сфокусированного контрола (Codex P1 #406).
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

  // Подскролл к выделенной строке.
  useEffect(() => {
    if (focusedIndex < 0) return;
    document
      .querySelector(`[data-doc-row-index="${focusedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex]);

  // ── Bulk-выделение ─────────────────────────────────────────
  // Выделять можно ЛЮБУЮ строку страницы — это нужно для подсчёта суммы
  // итогов по выделению (включая проведённые акты). Массовые ДЕЙСТВИЯ
  // показываются по-кнопочно, только когда ВСЕ выделенные акты подходят
  // для конкретного действия (см. canBulk* ниже) — без частичного применения.
  const selectableRows = initial.rows;
  const allSelected =
    selectableRows.length > 0 && selectableRows.every((row) => selectedIds.has(row.id));
  const someSelected = selectedIds.size > 0;

  const selectedRowsList = useMemo(
    () => initial.rows.filter((row) => selectedIds.has(row.id)),
    [initial.rows, selectedIds],
  );

  // Сумма итогов (нетто = излишки − недостачи) по выделенным строкам.
  const selectedNet = useMemo(() => {
    let net = 0;
    for (const row of selectedRowsList) {
      if (!row.results_has_line_amounts) continue;
      net += (row.surplus_sum ?? 0) - (row.shortfall_sum ?? 0);
    }
    return net;
  }, [selectedRowsList]);

  // Кнопка показывается, только если ДЕЙСТВИЕ применимо ко ВСЕМ выделенным
  // актам (иначе скрыта — никакого частичного применения):
  //  - «Исполнитель» — строже: лочится уже на проверке/пересчёте отдан;
  //  - «Проверяющий» / «Удалить» — лишь на проведённых / sync_error.
  const canBulkAssignee =
    selectedRowsList.length > 0 &&
    selectedRowsList.every((row) => getAssigneeLockReason(row.status) === null);
  const canBulkReviewer =
    selectedRowsList.length > 0 &&
    selectedRowsList.every((row) => getReviewerLockReason(row.status) === null);
  const canBulkDelete = canBulkReviewer;

  const clearSelection = () => setSelectedIds(new Set());

  // Чистим выделение от исчезнувших строк (после realtime/refresh).
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(initial.rows.map((row) => row.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => (present.has(id) ? next.add(id) : (changed = true)));
      return changed ? next : prev;
    });
  }, [initial.rows]);

  const applyBulkAssign = (role: "assignee" | "reviewer", userId: string | null) => {
    // Шлём только валидированные ID: строки, которые есть в текущем наборе
    // (initial.rows) И подходят для роли. Так stale-ID (выделенные, но уже
    // исчезнувшие до прунинга в useEffect) не попадут в мутацию.
    const ids = selectedRowsList
      .filter(
        (row) =>
          (role === "assignee" ? getAssigneeLockReason(row.status) : getReviewerLockReason(row.status)) ===
          null,
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
        `Обновлено: ${res.updated}` + (res.skipped > 0 ? `, пропущено: ${res.skipped}` : ""),
      );
      clearSelection();
      router.refresh();
    });
  };

  const applyBulkDelete = () => {
    // Только валидированные удаляемые строки (см. applyBulkAssign).
    const ids = selectedRowsList
      .filter((row) => getReviewerLockReason(row.status) === null)
      .map((row) => row.id);
    if (ids.length === 0) return;
    startBulk(async () => {
      const res = await bulkDeleteInventoryDocuments({ documentIds: ids });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`Удалено актов: ${res.deleted}`);
      setBulkDeleteOpen(false);
      clearSelection();
      router.refresh();
    });
  };

  // ── Columns (TanStack для visibility/order/sizing) ─────────
  const searchActive = Boolean(filtersFromUrl.q);

  const columnsConfig = useMemo(
    () => [
      ...(canManage
        ? [
            {
              id: "select",
              label: "",
              size: 44,
              canHide: false,
              cell: (row: DocumentListRow) => {
                return (
                  <span data-row-interactive onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.id)}
                      onChange={() =>
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        })
                      }
                      className="h-4 w-4 rounded border-input align-middle"
                      aria-label={`Выбрать акт ${row.document_number}`}
                    />
                  </span>
                );
              },
            },
          ]
        : []),
      {
        id: "document_number",
        label: "Номер",
        size: 130,
        canHide: false,
        cell: (row: DocumentListRow) => (
          <div className="min-w-0">
            <Link
              href={getDocHref(row, canViewResults)}
              className="block truncate text-sm font-medium hover:underline"
              data-row-interactive
              onClick={(e) => e.stopPropagation()}
            >
              № {row.document_number}
            </Link>
            {searchActive && row.matched_ingredients && row.matched_ingredients.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {row.matched_ingredients.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800"
                  >
                    <SearchIcon className="h-2.5 w-2.5" />
                    {name}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        id: "invoice_date",
        label: "Дата",
        size: 110,
        cell: (row: DocumentListRow) => <span className="text-sm">{formatDate(row.invoice_date)}</span>,
      },
      {
        id: "status",
        label: "Статус",
        size: 170,
        cell: (row: DocumentListRow) => <InventoryStatusBadge status={row.status} />,
      },
      {
        id: "store_title",
        label: "Склад",
        size: 200,
        cell: (row: DocumentListRow) => <span className="truncate text-sm">{row.store_title ?? "—"}</span>,
      },
      {
        id: "comment",
        label: "Комментарий",
        size: 240,
        cell: (row: DocumentListRow) => (
          <span className="block truncate text-sm text-muted-foreground" title={row.comment ?? undefined}>
            {row.comment ?? "—"}
          </span>
        ),
      },
      {
        id: "results",
        label: "Итоги",
        size: 130,
        // Одно число — нетто-расхождение (излишки − недостачи). Плюс →
        // зелёный (излишек), минус → красный (недостача), ноль — нейтрально.
        cell: (row: DocumentListRow) => {
          if (!row.results_has_line_amounts) {
            return <span className="text-sm text-muted-foreground">—</span>;
          }
          const net = (row.surplus_sum ?? 0) - (row.shortfall_sum ?? 0);
          const sign = net > 0 ? "+" : net < 0 ? "−" : "";
          return (
            <span
              className={cn(
                "text-sm font-medium tabular-nums",
                net > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : net < 0
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-muted-foreground",
              )}
            >
              {sign}
              {formatMoney(Math.abs(net), "RUB", amountRoundingScale)}
            </span>
          );
        },
      },
      {
        id: "assigned_to",
        label: "Исполнитель",
        size: 200,
        cell: (row: DocumentListRow) => {
          const lockReason = getAssigneeLockReason(row.status);
          if (canManage) {
            return (
              <div data-row-interactive onClick={(e) => e.stopPropagation()}>
                <AssigneeSelect
                  documentId={row.id}
                  assignedTo={row.assigned_to}
                  staff={staff}
                  lockReason={lockReason}
                  linkToPerson={canViewStaff}
                />
              </div>
            );
          }
          return (
            <ReadonlyPersonCell
              userId={row.assigned_to}
              staff={staff}
              locked={lockReason !== null}
              canViewStaff={canViewStaff}
            />
          );
        },
      },
      {
        id: "reviewer_id",
        label: "Проверяющий",
        size: 200,
        cell: (row: DocumentListRow) => {
          const lockReason = getReviewerLockReason(row.status);
          if (canManage) {
            return (
              <div data-row-interactive onClick={(e) => e.stopPropagation()}>
                <ReviewerSelect
                  documentId={row.id}
                  reviewerId={row.reviewer_id}
                  staff={staff}
                  lockReason={lockReason}
                  linkToPerson={canViewStaff}
                />
              </div>
            );
          }
          return (
            <ReadonlyPersonCell
              userId={row.reviewer_id}
              staff={staff}
              locked={lockReason !== null}
              canViewStaff={canViewStaff}
            />
          );
        },
      },
      {
        id: "actions",
        label: "",
        size: 56,
        canHide: false,
        cell: (row: DocumentListRow) => (
          <DesktopRowMenu doc={row} canManage={canManage} canViewResults={canViewResults} />
        ),
      },
    ],
    [amountRoundingScale, canManage, canViewResults, canViewStaff, searchActive, staff, selectedIds],
  );

  const stateColumns: TableStateColumn[] = useMemo(
    () =>
      columnsConfig.map((column) => ({
        id: column.id,
        defaultVisible: true,
        defaultSize: column.size,
      })),
    [columnsConfig],
  );

  const tableState = useTableState({ tableId: TABLE_ID, columns: stateColumns });

  const tableColumns = useMemo<ColumnDef<DocumentListRow>[]>(
    () =>
      columnsConfig.map((column) => ({
        id: column.id,
        header:
          column.id === "select"
            ? () => (
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allSelected && someSelected;
                  }}
                  disabled={selectableRows.length === 0}
                  onChange={() =>
                    setSelectedIds(
                      allSelected ? new Set() : new Set(selectableRows.map((row) => row.id)),
                    )
                  }
                  className="h-4 w-4 rounded border-input align-middle"
                  aria-label="Выбрать все"
                />
              )
            : column.label,
        size: column.size,
        // min ≈ ширина заголовка: ресайз не сжимает колонку уже её названия.
        // «Исполнитель»/«Проверяющий» — длинные заголовки, им нужен больший min.
        minSize:
          column.id === "select"
            ? 44
            : column.id === "actions"
              ? 56
              : column.id === "assigned_to" || column.id === "reviewer_id"
                ? 116
                : column.id === "status"
                  ? 120
                  : 96,
        enableHiding: column.canHide !== false,
        enableResizing: column.id !== "select" && column.id !== "actions",
        cell: ({ row }) => column.cell(row.original),
      })),
    [columnsConfig, allSelected, someSelected, selectableRows],
  );

  const table = useReactTable({
    data: initial.rows,
    columns: tableColumns,
    state: {
      columnVisibility: tableState.columnVisibility,
      columnOrder: tableState.columnOrder,
      columnSizing: tableState.columnSizing,
    },
    getRowId: (row) => row.id,
    columnResizeMode: "onChange",
    onColumnVisibilityChange: tableState.setColumnVisibility,
    onColumnOrderChange: tableState.setColumnOrder,
    onColumnSizingChange: tableState.setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
  });

  // Из выпадашки «Столбцы» исключаем служебную колонку actions —
  // её нельзя ни скрыть, ни переупорядочить, в UI она шум.
  const managedColumns: ManagedTableColumn[] = tableState.columnOrder
    .filter((id) => id !== "actions" && id !== "select")
    .map((id) => table.getAllLeafColumns().find((col) => col.id === id))
    .filter((col): col is NonNullable<typeof col> => Boolean(col))
    .map((col) => ({
      id: col.id,
      label: String(col.columnDef.header ?? col.id),
      visible: col.getIsVisible(),
      canHide: col.getCanHide(),
      width: col.getSize(),
    }));

  const moveColumn = (activeId: string, overId: string) => {
    tableState.setColumnOrder((current) => {
      const oldIndex = current.indexOf(activeId);
      const newIndex = current.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) return current;
      return arrayMove(current, oldIndex, newIndex);
    });
  };

  // ── Filter handlers ────────────────────────────────────────
  const onVenueChange = (next: string) =>
    updateUrl({ venue: next === "all" ? null : next }, { resetPage: true });

  const onStatusToggle = (status: DocumentStatus) => {
    const current = new Set(filtersFromUrl.status ?? []);
    if (current.has(status)) current.delete(status);
    else current.add(status);
    updateUrl({ status: Array.from(current) }, { resetPage: true });
  };

  const onAssignedChange = (next: string) =>
    updateUrl({ assigned: next === "any" ? null : next }, { resetPage: true });

  const onReviewerChange = (next: string) =>
    updateUrl({ reviewer: next === "any" ? null : next }, { resetPage: true });

  const onStoreToggle = (storeId: string) => {
    const current = new Set(filtersFromUrl.store ?? []);
    if (current.has(storeId)) current.delete(storeId);
    else current.add(storeId);
    updateUrl({ store: Array.from(current) }, { resetPage: true });
  };

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

  const setSortKeys = (next: DocumentSortMode[]) => {
    const cleaned = next.length === 0 ? DEFAULT_SORT : next;
    updateUrl(
      { sort: isDefaultSort(cleaned) ? null : cleaned },
      { resetPage: true },
    );
  };

  const onClearAll = () => {
    setSearch("");
    router.replace(pathname);
  };

  const hasActiveFilters =
    (filtersFromUrl.venue && filtersFromUrl.venue !== "all") ||
    (filtersFromUrl.status && filtersFromUrl.status.length > 0) ||
    (filtersFromUrl.assigned && filtersFromUrl.assigned !== "any") ||
    (filtersFromUrl.reviewer && filtersFromUrl.reviewer !== "any") ||
    (filtersFromUrl.store && filtersFromUrl.store.length > 0) ||
    Boolean(filtersFromUrl.date_from || filtersFromUrl.date_to);

  const hasSearch = Boolean(filtersFromUrl.q);
  const hasSortActive = !isDefaultSort(sortFromUrl);
  const hasAnyActive = hasActiveFilters || hasSearch || hasSortActive;

  // ── Sync QR ────────────────────────────────────────────────
  const runSync = (scope: "documents" | "full") => {
    startSyncTransition(async () => {
      try {
        const result = await syncQuickRestoInventory({ scope });
        if (result.error || !result.summary) {
          toast.error(result.error ?? "Синхронизация не выполнена");
          return;
        }
        toast.success(
          scope === "documents"
            ? `Синхронизировано актов: ${result.summary.documents}`
            : `Синхронизировано: позиций ${result.summary.products}, актов ${result.summary.documents}`,
        );
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Синхронизация не выполнена");
      }
    });
  };

  // ── Header click → multi-sort cycle (table-lab pattern) ──
  // Колонка не в сортировке → APPEND asc.
  // Колонка в сортировке (asc) → FLIP desc.
  // Колонка в сортировке (desc) → REMOVE.
  // Так у каждой колонки 3 состояния: пусто → ↑ → ↓ → пусто.
  // Для Date (дефолт сервера = date_desc) пустое состояние = «дефолт»:
  // URL чист, шапка без индикатора, сервер сам сортирует по дате desc.
  const cycleSort = (field: SortField) => {
    const index = sortFromUrl.findIndex((mode) => sortToField(mode) === field);
    if (index < 0) {
      setSortKeys([...sortFromUrl, combineSort(field, "asc")]);
      return;
    }
    const currentMode = sortFromUrl[index];
    if (sortToDirection(currentMode) === "asc") {
      const next = sortFromUrl.slice();
      next[index] = combineSort(field, "desc");
      setSortKeys(next);
      return;
    }
    setSortKeys(sortFromUrl.filter((_, i) => i !== index));
  };

  const headerIndicator = (columnId: string) => {
    const field = COLUMN_TO_FIELD[columnId];
    if (!field) return null;
    const idx = sortFromUrl.findIndex((mode) => sortToField(mode) === field);
    if (idx < 0) return null;
    const dir = sortToDirection(sortFromUrl[idx]);
    return (
      <span className="inline-flex items-center gap-0.5">
        {dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
        {sortFromUrl.length > 1 ? (
          <span className="text-[10px] tabular-nums">{idx + 1}</span>
        ) : null}
      </span>
    );
  };

  const sortableHeaderIds = new Set(Object.keys(COLUMN_TO_FIELD));

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

  // Search pin показываем, как в эталоне: когда поиск активен, а pins-row
  // уже виден из-за других условий — sort или filters или активные фильтры.
  const showSearchPin = hasSearch && (filtersVisible || hasSortActive || hasActiveFilters);

  return (
    <div className="w-full space-y-6 p-6 md:p-8">
      <TablePageHeader
        title="Акты инвентаризации"
        subtitle="Заполнение, итоги и пересорт по строкам Quick Resto"
        actions={
          <TableControls
            search={{
              value: search,
              onChange: setSearch,
              open: searchOpen,
              onOpenChange: setSearchOpen,
              placeholder: "Поиск",
            }}
            filters={{
              // active подсвечивает кнопку только когда выбран хотя бы один
              // фильтр. «Открыт ли pin-row» — отдельное состояние:
              // переключается тем же кликом, но визуально кнопка остаётся
              // нейтральной до тех пор, пока пользователь не выберет значение.
              active: hasActiveFilters,
              label: filtersVisible ? "Скрыть фильтры" : "Показать фильтры",
              onClick: () => setFiltersVisible((v) => !v),
            }}
            sort={{
              active: hasSortActive,
              content: <SortFieldPanel sorts={sortFromUrl} onChange={setSortKeys} />,
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
            primaryActions={
              canSync ? (
                <TableSplitButton
                  label="Синхронизировать QR"
                  icon={isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  primaryTooltip="Только акты"
                  menuTooltip="Выбрать объём синхронизации"
                  disabled={isSyncing}
                  onPrimaryClick={() => runSync("documents")}
                  options={[
                    { label: "Только акты",                onSelect: () => runSync("documents") },
                    { label: "Акты, ингредиенты и склады", onSelect: () => runSync("full") },
                  ]}
                />
              ) : null
            }
            summary={
              <>
                Показано {showingFrom}-{showingTo} из {total}
              </>
            }
          />
        }
      />

      {/* Pins row — порядок: Сортировка → Фильтры → Поиск. Эталон:
          dev/table-lab → ActiveTablePins в FinanceDemo. */}
      {/* Pin-row НЕ показываем, если активен только поиск (без фильтров/
          сортировки) — иначе торчит одинокая «Очистить все». */}
      {(filtersVisible || hasSortActive || hasActiveFilters) ? (
        <div className="flex flex-wrap items-center gap-2">
          {/* 1. Сортировка — один пин на все ключи (как в эталоне) */}
          {hasSortActive ? (
            <TableControlPin
              active
              icon={
                sortFromUrl.length === 1
                  ? sortToDirection(sortFromUrl[0]) === "asc"
                    ? <ArrowUp className="h-3.5 w-3.5" />
                    : <ArrowDown className="h-3.5 w-3.5" />
                  : <ArrowUpDown className="h-3.5 w-3.5" />
              }
              label={
                sortFromUrl.length === 1
                  ? SORT_FIELD_LABEL[sortToField(sortFromUrl[0])]
                  : `${sortFromUrl.length} сортировки`
              }
              contentClassName="w-auto p-3"
            >
              <SortPinEditor sorts={sortFromUrl} onChange={setSortKeys} />
            </TableControlPin>
          ) : null}

          {hasSortActive && (filtersVisible || showSearchPin) ? <PinDivider /> : null}

          {/* 2. Фильтры — порядок: Период, Статус, Исполнитель, Склад, Заведение */}
          {filtersVisible ? (
            <>
              <DateRangeFilter
                value={dateRange}
                presetLabel={datePresetFromUrl}
                onChange={onDateRangeChange}
              />

              <TableControlPin
                active={(filtersFromUrl.status?.length ?? 0) > 0}
                label={statusPinLabel(filtersFromUrl.status)}
                onClear={
                  (filtersFromUrl.status?.length ?? 0) > 0
                    ? () => updateUrl({ status: null }, { resetPage: true })
                    : undefined
                }
                clearLabel="Сбросить статус"
              >
                <StatusPicker value={filtersFromUrl.status ?? []} onToggle={onStatusToggle} />
              </TableControlPin>

              {canManage ? (
                <TableControlPin
                  active={Boolean(filtersFromUrl.assigned) && filtersFromUrl.assigned !== "any"}
                  label={assigneePinLabel(filtersFromUrl.assigned, staff)}
                  onClear={
                    filtersFromUrl.assigned && filtersFromUrl.assigned !== "any"
                      ? () => onAssignedChange("any")
                      : undefined
                  }
                  clearLabel="Сбросить исполнителя"
                >
                  <AssignedPicker value={filtersFromUrl.assigned ?? "any"} staff={staff} onChange={onAssignedChange} />
                </TableControlPin>
              ) : null}

              {canManage ? (
                <TableControlPin
                  active={Boolean(filtersFromUrl.reviewer) && filtersFromUrl.reviewer !== "any"}
                  label={reviewerPinLabel(filtersFromUrl.reviewer, staff)}
                  onClear={
                    filtersFromUrl.reviewer && filtersFromUrl.reviewer !== "any"
                      ? () => onReviewerChange("any")
                      : undefined
                  }
                  clearLabel="Сбросить проверяющего"
                >
                  <ReviewerPicker value={filtersFromUrl.reviewer ?? "any"} staff={staff} onChange={onReviewerChange} />
                </TableControlPin>
              ) : null}

              <TableControlPin
                active={(filtersFromUrl.store?.length ?? 0) > 0}
                label={storePinLabel(filtersFromUrl.store, stores)}
                onClear={
                  (filtersFromUrl.store?.length ?? 0) > 0
                    ? () => updateUrl({ store: null }, { resetPage: true })
                    : undefined
                }
                clearLabel="Сбросить склад"
              >
                <StorePicker value={filtersFromUrl.store ?? []} stores={stores} onToggle={onStoreToggle} />
              </TableControlPin>

              <TableControlPin
                active={Boolean(filtersFromUrl.venue) && filtersFromUrl.venue !== "all"}
                label={venuePinLabel(filtersFromUrl.venue, venues)}
                onClear={
                  filtersFromUrl.venue && filtersFromUrl.venue !== "all"
                    ? () => onVenueChange("all")
                    : undefined
                }
                clearLabel="Сбросить заведение"
              >
                <VenuePicker value={filtersFromUrl.venue ?? "all"} venues={venues} onChange={onVenueChange} />
              </TableControlPin>
            </>
          ) : null}

          {filtersVisible && showSearchPin ? <PinDivider /> : null}

          {/* 3. Поиск */}
          {showSearchPin ? (
            <TableControlPin
              active
              label={`Поиск: ${(filtersFromUrl.q ?? "").trim()}`}
              icon={<SearchIcon className="h-3.5 w-3.5" />}
              onClear={() => setSearch("")}
              clearLabel="Очистить поиск"
            >
              <div className="space-y-2 p-2">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Поиск"
                  className="h-8"
                />
                <p className="text-xs text-muted-foreground">
                  По № акта, комментарию и названиям ингредиентов.
                </p>
              </div>
            </TableControlPin>
          ) : null}

          {hasAnyActive ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onClearAll}
            >
              Очистить все
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Desktop table — TanStack для column-state, resize-handles.
          Каркас: rounded-lg (8px, "base" из .pen Q4FzoZ → xA95j) + bg-card +
          header bg-muted/60. Закругление совпадает с реальным Table-компонентом
          в .pen (`E:bG7YL` cornerRadius:8) и с нашим --radius:0.5rem; такая же
          пара 8/6 (table/button) читается как одна семья — без визуальных
          уровней rounded-md/rounded-xl. bg-card важен в dark: card light-er
          чем background, таблица читается как elevated блок, а не сливается. */}
      {/* Без overflow на обёртках (иначе sticky-thead «ловится» контейнером).
          Таблица вписана в ширину (table-fixed + colgroup в %), горизонтального
          скролла нет, ресайз перетягивает ширину у соседей, шапка липнет к
          верху страницы при оконном скролле. См. design-system → sticky header. */}
      <div className="hidden rounded-lg border bg-card md:block">
          <table
            // Браузерные расширения вроде TableConvert / Copy-As-Markdown
            // дописывают на <table> атрибуты `data-tableconvert-*` между
            // SSR-HTML и hydration. React видит их как mismatch, бэйлит
            // гидрацию всего поддерева, перерендерит с нуля → каскад
            // разных useId() в шапке/сайдбаре/селектах. suppress даёт
            // React принять «лишние» атрибуты и продолжить hydrate.
            suppressHydrationWarning
            className="w-full table-fixed"
          >
            <colgroup>
              {table.getVisibleLeafColumns().map((column) => (
                <col
                  key={column.id}
                  // Проценты от ширины таблицы (нормализация) → колонки всегда
                  // вписаны без горизонтального скролла; ресайз меняет доли.
                  style={{ width: `${(column.getSize() / table.getTotalSize()) * 100}%` }}
                />
              ))}
            </colgroup>
            <thead className="group/header sticky top-0 z-20 bg-muted [&_th]:bg-muted text-xs font-medium tracking-wide text-muted-foreground">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="h-11">
                  {headerGroup.headers.map((header) => {
                    const isActions = header.column.id === "actions";
                    const isSortable = sortableHeaderIds.has(header.column.id);
                    return (
                      <th
                        key={header.id}
                        className={cn(
                          "relative border-b px-3 py-3",
                          isActions ? "text-right" : "text-left",
                        )}
                      >
                        {isActions ? null : isSortable ? (
                          <button
                            type="button"
                            className="flex max-w-full items-center gap-1 truncate hover:text-foreground"
                            onClick={() => cycleSort(COLUMN_TO_FIELD[header.column.id])}
                          >
                            <span className="truncate">
                              {flexRender(header.column.columnDef.header, header.getContext())}
                            </span>
                            {headerIndicator(header.column.id)}
                          </button>
                        ) : (
                          <span className="truncate">
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </span>
                        )}
                        {header.column.getCanResize() && !isActions ? (
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
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={table.getVisibleLeafColumns().length} className="p-0">
                    <EmptyTableBody
                      canSync={canSync}
                      hasActive={hasAnyActive}
                      onClearAll={onClearAll}
                      onSync={() => runSync("documents")}
                    />
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    data-doc-row-index={row.index}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.closest("[data-row-interactive]")) return;
                      router.push(getDocHref(row.original, canViewResults));
                    }}
                    className={cn(
                      "cursor-pointer border-b last:border-b-0 hover:bg-muted/30",
                      row.index === focusedIndex ? "bg-muted/50 ring-1 ring-inset ring-brand/40" : null,
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={cn(
                          // overflow-hidden: контент не вылезает на соседнюю
                          // колонку при сужении (троеточие у внутренних truncate).
                          "overflow-hidden px-3 py-3 align-middle text-sm",
                          cell.column.id === "actions" ? "text-right" : null,
                        )}
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

      {/* Mobile cards (без TanStack — отдельный layout) */}
      <div className="grid gap-2 md:hidden">
        {initial.rows.length === 0 ? (
          <EmptyTableBody
            canSync={canSync}
            hasActive={hasAnyActive}
            onClearAll={onClearAll}
            onSync={() => runSync("documents")}
          />
        ) : (
          initial.rows.map((doc) => (
            <MobileCard
              key={doc.id}
              doc={doc}
              staff={staff}
              canManage={canManage}
              canViewResults={canViewResults}
              canViewStaff={canViewStaff}
              amountRoundingScale={amountRoundingScale}
              searchActive={searchActive}
            />
          ))
        )}
      </div>

      <TablePagination
        pageIndex={pageFromUrl - 1}
        pageSize={pageSizeFromUrl}
        total={total}
        onPageChange={(idx) => updateUrl({ page: String(idx + 1) }, { mode: "push" })}
        onPageSizeChange={(size) => updateUrl({ size: String(size), page: null })}
      />

      {canManage && someSelected ? (
        <TableBulkBar
          selectedCount={selectedIds.size}
          onClear={clearSelection}
          floating
          summary={
            <span
              className={cn(
                "whitespace-nowrap text-sm font-medium tabular-nums",
                selectedNet > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : selectedNet < 0
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-muted-foreground",
              )}
            >
              Итог: {selectedNet > 0 ? "+" : selectedNet < 0 ? "−" : ""}
              {formatMoney(Math.abs(selectedNet), "RUB", amountRoundingScale)}
            </span>
          }
          actions={
            // Каждая кнопка показывается, только когда действие применимо ко
            // ВСЕМ выделенным актам (без частичного применения). «Исполнитель»
            // строже: исчезает уже когда выделен акт на проверке/проведённый.
            canBulkAssignee || canBulkReviewer || canBulkDelete ? (
              <>
                {canBulkAssignee ? (
                  <BulkAssignMenu
                    label="Исполнитель"
                    icon={<UserPlus className="mr-2 h-4 w-4" />}
                    staff={staff}
                    disabled={bulkPending}
                    onPick={(userId) => applyBulkAssign("assignee", userId)}
                  />
                ) : null}
                {canBulkReviewer ? (
                  <BulkAssignMenu
                    label="Проверяющий"
                    icon={<ShieldCheck className="mr-2 h-4 w-4" />}
                    staff={staff}
                    disabled={bulkPending}
                    onPick={(userId) => applyBulkAssign("reviewer", userId)}
                  />
                ) : null}
                {canBulkDelete ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={bulkPending}
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Удалить
                  </Button>
                ) : null}
              </>
            ) : undefined
          }
        />
      ) : null}

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить акты ({selectedRowsList.length})?</AlertDialogTitle>
            <AlertDialogDescription>
              Это удалит выбранные акты и все их позиции. Акты из Quick Resto могут
              вернуться при следующей синхронизации.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkPending}
              onClick={(e) => {
                e.preventDefault();
                applyBulkDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

