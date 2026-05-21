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
  ClipboardCheck,
  FileX2,
  Inbox,
  Loader2,
  Plus,
  RefreshCw,
  Search as SearchIcon,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
  XCircle,
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
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatMoney, type AmountRoundingScale } from "@/lib/format/amount";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range-filter";
import { InventoryStatusBadge, INVENTORY_STATUS_LABEL } from "@/components/shared/inventory-status-badge";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  bulkAssignInventoryDocuments,
  bulkDeleteInventoryDocuments,
  deleteInventoryDocument,
  syncQuickRestoInventory,
} from "@/app/(dashboard)/inventory/actions";
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client";

import { AssigneeSelect, type AssigneeOption } from "./assignee-select";
import { ReviewerSelect } from "./reviewer-select";
import {
  DEFAULT_SORT,
  DOCUMENT_STATUSES,
  isDefaultSort,
  type DocumentListRow,
  type DocumentSortMode,
  type DocumentStatus,
  type ListDocumentsFilters,
  type ListDocumentsResult,
} from "@/lib/inventory/list-documents-shared";

// ─── Constants ───────────────────────────────────────────────────────────────

// STATUS_LABEL переиспользуется из shared-компонента InventoryStatusBadge
// (там и dark-варианты палитры). Pin'ы и mobile-карточки рендерят бейдж
// напрямую через <InventoryStatusBadge>.
const STATUS_LABEL = INVENTORY_STATUS_LABEL as Record<DocumentStatus, string>;

type SortField = "date" | "number" | "status";

const SORT_FIELD_LABEL: Record<SortField, string> = {
  date:   "Дата",
  number: "Номер",
  status: "Статус",
};

const SORT_FIELDS: SortField[] = ["date", "number", "status"];

// Привязка между UI-полем сортировки и заголовком колонки таблицы.
const COLUMN_TO_FIELD: Record<string, SortField> = {
  document_number: "number",
  invoice_date:    "date",
  status:          "status",
};
function sortToField(mode: DocumentSortMode): SortField {
  if (mode === "date_desc" || mode === "date_asc") return "date";
  if (mode === "number_desc" || mode === "number_asc") return "number";
  return "status";
}

function sortToDirection(mode: DocumentSortMode): "asc" | "desc" {
  return mode.endsWith("_asc") ? "asc" : "desc";
}

function combineSort(field: SortField, direction: "asc" | "desc"): DocumentSortMode {
  if (field === "status") return direction === "asc" ? "status_asc" : "status_desc";
  if (field === "date")   return direction === "asc" ? "date_asc" : "date_desc";
  return direction === "asc" ? "number_asc" : "number_desc";
}


const SEARCH_DEBOUNCE_MS = 250;

// Статусы, в которых менять ответственного нельзя.
// processed → акт закрыт, исторические данные.
// sync_error → нужно чинить sync, до этого назначать бессмысленно.
function getAssignLockReason(status: string): string | null {
  if (status === "processed") return "Акт проведён — исполнителя больше менять нельзя";
  if (status === "sync_error") return "Ошибка синхронизации — сначала восстановите акт из Quick Resto";
  return null;
}
const TABLE_ID = "documents.list";

// ─── Props ───────────────────────────────────────────────────────────────────

export type VenueOption = { id: string; name: string };
export type StoreOption = { id: string; title: string };

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
  amountRoundingScale: AmountRoundingScale;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

// canViewResults обязателен: пользователи с inventory.fill_assigned_documents,
// но без inventory.view_results, не могут открыть /results — их редиректнёт
// прочь. Поэтому для них всегда возвращаем форму, даже у проведённых актов.
// Codex review #396 P1.
function getDocHref(
  doc: Pick<DocumentListRow, "id" | "processed" | "results_has_line_amounts" | "status">,
  canViewResults: boolean,
) {
  const isResultsState =
    doc.processed || doc.results_has_line_amounts || doc.status === "results_blocked";
  if (isResultsState && canViewResults) {
    return `/documents/inventory/${doc.id}/results`;
  }
  return `/documents/inventory/${doc.id}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ru-RU");
  } catch {
    return iso;
  }
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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
  // Выделять можно только акты, которым можно менять назначение
  // (не «Проведён» / «Ошибка синхронизации» — как getAssignLockReason).
  const selectableRows = useMemo(
    () => initial.rows.filter((row) => getAssignLockReason(row.status) === null),
    [initial.rows],
  );
  const allSelected =
    selectableRows.length > 0 && selectableRows.every((row) => selectedIds.has(row.id));
  const someSelected = selectedIds.size > 0;

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
    const ids = Array.from(selectedIds);
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
    const ids = Array.from(selectedIds);
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
                const locked = getAssignLockReason(row.status) !== null;
                return (
                  <span data-row-interactive onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.id)}
                      disabled={locked}
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
        size: 200,
        cell: (row: DocumentListRow) =>
          row.results_has_line_amounts ? (
            <span className="text-sm">
              −{formatMoney(Math.abs(row.shortfall_sum ?? 0), "RUB", amountRoundingScale)} / +{formatMoney(Math.abs(row.surplus_sum ?? 0), "RUB", amountRoundingScale)}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      {
        id: "assigned_to",
        label: "Исполнитель",
        size: 200,
        cell: (row: DocumentListRow) => {
          const lockReason = getAssignLockReason(row.status);
          return canManage ? (
            <div data-row-interactive onClick={(e) => e.stopPropagation()}>
              <AssigneeSelect
                documentId={row.id}
                assignedTo={row.assigned_to}
                staff={staff}
                lockReason={lockReason}
              />
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              {staff.find((m) => m.id === row.assigned_to)?.name ?? "—"}
            </span>
          );
        },
      },
      {
        id: "reviewer_id",
        label: "Проверяющий",
        size: 200,
        cell: (row: DocumentListRow) => {
          const lockReason = getAssignLockReason(row.status);
          return canManage ? (
            <div data-row-interactive onClick={(e) => e.stopPropagation()}>
              <ReviewerSelect
                documentId={row.id}
                reviewerId={row.reviewer_id}
                staff={staff}
                lockReason={lockReason}
              />
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              {staff.find((m) => m.id === row.reviewer_id)?.name ?? "—"}
            </span>
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
    [amountRoundingScale, canManage, canViewResults, searchActive, staff, selectedIds],
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
          actions={
            <>
              <BulkAssignMenu
                label="Назначить исполнителя"
                staff={staff}
                disabled={bulkPending}
                onPick={(userId) => applyBulkAssign("assignee", userId)}
              />
              <BulkAssignMenu
                label="Назначить проверяющего"
                staff={staff}
                disabled={bulkPending}
                onPick={(userId) => applyBulkAssign("reviewer", userId)}
              />
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
            </>
          }
        />
      ) : null}

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить акты ({selectedIds.size})?</AlertDialogTitle>
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

function BulkAssignMenu({
  label,
  staff,
  disabled,
  onPick,
}: {
  label: string;
  staff: AssigneeOption[];
  disabled?: boolean;
  onPick: (userId: string | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={disabled}>
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onPick(null)} className="text-muted-foreground">
          Снять
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {staff.map((member) => (
          <DropdownMenuItem key={member.id} onClick={() => onPick(member.id)}>
            {member.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function PinDivider() {
  return <div className="mx-1 h-6 w-px bg-border" aria-hidden="true" />;
}

function DesktopRowMenu({
  doc,
  canManage,
  canViewResults,
}: {
  doc: DocumentListRow;
  canManage: boolean;
  canViewResults: boolean;
}) {
  const router = useRouter();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  const actions = useMemo(() => {
    const items: { label: string; icon: React.ReactNode; onSelect: () => void; destructive?: boolean; separatorBefore?: boolean }[] = [];
    // После объединения экранов акта табами «Заполнение/Итоги» в shared
    // layout — переключение через UI акта, поэтому в row-menu один
    // пункт «Открыть» по умолчанию-табу из getDocHref. getDocHref сам
    // учитывает canViewResults, чтобы fill-only пользователей не уносило
    // на /results, куда у них нет доступа (Codex P1 #396).
    items.push({
      label: "Открыть",
      icon: <ClipboardCheck className="h-4 w-4" />,
      onSelect: () => router.push(getDocHref(doc, canViewResults)),
    });
    if (canManage) {
      items.push({
        label: "Удалить",
        icon: <Trash2 className="h-4 w-4" />,
        destructive: true,
        separatorBefore: true,
        onSelect: () => setConfirmDeleteOpen(true),
      });
    }
    return items;
  }, [doc, router, canManage, canViewResults]);

  const runDelete = () => {
    startDelete(async () => {
      try {
        const result = await deleteInventoryDocument({ documentId: doc.id });
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success(`Акт № ${doc.document_number} удалён`);
        setConfirmDeleteOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось удалить акт");
      }
    });
  };

  return (
    <div data-row-interactive onClick={(e) => e.stopPropagation()}>
      <TableRowMenu actions={actions} />
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить акт № {doc.document_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              Это удалит акт и все его позиции. Если акт пришёл из Quick Resto,
              он может вернуться при следующей синхронизации.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                runDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Pin labels ──────────────────────────────────────────────────────────────

function venuePinLabel(venue: string | undefined, venues: VenueOption[]): string {
  if (!venue || venue === "all") return "Заведения";
  if (venue === "unassigned") return "Не распределённые";
  return venues.find((v) => v.id === venue)?.name ?? "Заведения";
}

function statusPinLabel(status: DocumentStatus[] | undefined): string {
  if (!status || status.length === 0) return "Статус";
  if (status.length === 1) return STATUS_LABEL[status[0]];
  return `Статус: ${status.length}`;
}

function assigneePinLabel(assigned: string | undefined, staff: AssigneeOption[]): string {
  if (!assigned || assigned === "any") return "Исполнитель";
  if (assigned === "me") return "На меня";
  if (assigned === "none") return "Без назначения";
  return staff.find((s) => s.id === assigned)?.name ?? "Исполнитель";
}

function reviewerPinLabel(reviewer: string | undefined, staff: AssigneeOption[]): string {
  if (!reviewer || reviewer === "any") return "Проверяющий";
  if (reviewer === "me") return "Проверяю я";
  if (reviewer === "none") return "Без проверяющего";
  return staff.find((s) => s.id === reviewer)?.name ?? "Проверяющий";
}

function storePinLabel(store: string[] | undefined, stores: StoreOption[]): string {
  if (!store || store.length === 0) return "Склад";
  if (store.length === 1) return stores.find((s) => s.id === store[0])?.title ?? "Склад";
  return `Склад: ${store.length}`;
}

// ─── Pickers ─────────────────────────────────────────────────────────────────

function VenuePicker({
  value,
  venues,
  onChange,
}: {
  value: string;
  venues: VenueOption[];
  onChange: (v: string) => void;
}) {
  const options = [
    { value: "all", label: "Все заведения" },
    { value: "unassigned", label: "Не распределённые" },
    ...venues.map((v) => ({ value: v.id, label: v.name })),
  ];
  return (
    <div className="max-h-64 space-y-0.5 overflow-y-auto p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent",
            opt.value === value ? "bg-accent" : null,
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function StatusPicker({
  value,
  onToggle,
}: {
  value: DocumentStatus[];
  onToggle: (s: DocumentStatus) => void;
}) {
  const selected = new Set(value);
  return (
    <div className="space-y-0.5 p-1">
      {DOCUMENT_STATUSES.map((status) => (
        <label
          key={status}
          className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent cursor-pointer"
        >
          <Checkbox checked={selected.has(status)} onCheckedChange={() => onToggle(status)} />
          <span>{STATUS_LABEL[status]}</span>
        </label>
      ))}
    </div>
  );
}

function StorePicker({
  value,
  stores,
  onToggle,
}: {
  value: string[];
  stores: StoreOption[];
  onToggle: (id: string) => void;
}) {
  const selected = new Set(value);
  return (
    <div className="max-h-64 space-y-0.5 overflow-y-auto p-1">
      {stores.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">Складов нет</div>
      ) : (
        stores.map((store) => (
          <label
            key={store.id}
            className="flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent cursor-pointer"
          >
            <Checkbox
              checked={selected.has(store.id)}
              onCheckedChange={() => onToggle(store.id)}
            />
            <span className="truncate">{store.title}</span>
          </label>
        ))
      )}
    </div>
  );
}

function AssignedPicker({
  value,
  staff,
  onChange,
}: {
  value: string;
  staff: AssigneeOption[];
  onChange: (v: string) => void;
}) {
  const options = [
    { value: "any",  label: "Любой исполнитель" },
    { value: "me",   label: "На меня" },
    { value: "none", label: "Без назначения" },
    ...staff.map((s) => ({ value: s.id, label: s.name })),
  ];
  return (
    <div className="max-h-64 space-y-0.5 overflow-y-auto p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent",
            opt.value === value ? "bg-accent" : null,
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ReviewerPicker({
  value,
  staff,
  onChange,
}: {
  value: string;
  staff: AssigneeOption[];
  onChange: (v: string) => void;
}) {
  const options = [
    { value: "any",  label: "Любой проверяющий" },
    { value: "me",   label: "Проверяю я" },
    { value: "none", label: "Без проверяющего" },
    ...staff.map((s) => ({ value: s.id, label: s.name })),
  ];
  return (
    <div className="max-h-64 space-y-0.5 overflow-y-auto p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent",
            opt.value === value ? "bg-accent" : null,
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Popover из шапки таблицы (TableControls.sort.content). Эталон:
 * SortFieldPanel в dev/table-lab. Один список полей; клик на поле,
 * которого ещё нет в сортировке — APPEND с направлением asc.
 * Поле, которое уже в сортировке, помечается «Добавлено».
 */
function SortFieldPanel({
  sorts,
  onChange,
}: {
  sorts: DocumentSortMode[];
  onChange: (next: DocumentSortMode[]) => void;
}) {
  const usedFields = new Set(sorts.map((mode) => sortToField(mode)));
  return (
    <div className="space-y-3">
      <p className="px-3 pt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        Сортировка
      </p>
      <div className="space-y-1">
        {SORT_FIELDS.map((field) => {
          const used = usedFields.has(field);
          return (
            <button
              key={field}
              type="button"
              onClick={() => {
                if (used) return;
                onChange([...sorts, combineSort(field, "asc")]);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-accent",
                used ? "bg-accent text-muted-foreground" : null,
              )}
            >
              <span>{SORT_FIELD_LABEL[field]}</span>
              {used ? <span className="text-xs">Добавлено</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Содержимое пина активной сортировки. Эталон: SortPinEditor в
 * dev/table-lab. Каждая сортировка — строка с field-select +
 * direction-select + крестик. Кнопки: «Добавить сортировку» (список
 * неиспользованных полей) и «Удалить сортировку» (всё).
 */
function SortPinEditor({
  sorts,
  onChange,
}: {
  sorts: DocumentSortMode[];
  onChange: (next: DocumentSortMode[]) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);

  const unusedFields = SORT_FIELDS.filter(
    (field) => !sorts.some((mode) => sortToField(mode) === field),
  );

  const updateAt = (index: number, next: DocumentSortMode) => {
    onChange(sorts.map((mode, i) => (i === index ? next : mode)));
  };

  const replaceField = (index: number, field: SortField) => {
    const currentDirection = sortToDirection(sorts[index]);
    updateAt(index, combineSort(field, currentDirection));
  };

  const removeAt = (index: number) => {
    onChange(sorts.filter((_, i) => i !== index));
  };

  return (
    <div className="w-[min(420px,calc(100vw-3rem))] space-y-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Сортировка
      </p>

      <div className="space-y-2">
        {sorts.map((mode, index) => {
          const field = sortToField(mode);
          const direction = sortToDirection(mode);
          return (
            <div key={`${field}-${index}`} className="grid grid-cols-[1fr_72px_32px] items-center gap-2">
              <Select value={field} onValueChange={(value) => replaceField(index, value as SortField)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_FIELDS.map((option) => {
                    const disabled = sorts.some(
                      (other, otherIndex) => otherIndex !== index && sortToField(other) === option,
                    );
                    return (
                      <SelectItem key={option} value={option} disabled={disabled}>
                        {SORT_FIELD_LABEL[option]}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>

              <Select
                value={direction}
                onValueChange={(value) => updateAt(index, combineSort(field, value as "asc" | "desc"))}
              >
                <SelectTrigger
                  className="h-9 w-[72px] justify-center gap-1 px-2"
                  aria-label={direction === "asc" ? "По возрастанию" : "По убыванию"}
                >
                  {direction === "asc" ? (
                    <ArrowUp className="h-4 w-4" />
                  ) : (
                    <ArrowDown className="h-4 w-4" />
                  )}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asc">
                    <span className="inline-flex items-center gap-2">
                      <ArrowUp className="h-3.5 w-3.5" /> По возрастанию
                    </span>
                  </SelectItem>
                  <SelectItem value="desc">
                    <span className="inline-flex items-center gap-2">
                      <ArrowDown className="h-3.5 w-3.5" /> По убыванию
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => removeAt(index)}
                aria-label="Удалить сортировку"
              >
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
      </div>

      {showAdd && unusedFields.length > 0 ? (
        <div className="rounded-lg border bg-background p-2">
          {unusedFields.map((field) => (
            <button
              key={field}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                onChange([...sorts, combineSort(field, "asc")]);
                setShowAdd(false);
              }}
            >
              <ArrowUp className="h-4 w-4 text-muted-foreground" />
              {SORT_FIELD_LABEL[field]}
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
          disabled={unusedFields.length === 0}
          onClick={() => setShowAdd((current) => !current)}
        >
          <Plus className="h-4 w-4" />
          Добавить сортировку
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive"
          onClick={() => onChange([])}
        >
          <Trash2 className="h-4 w-4" />
          Удалить сортировку
        </Button>
      </div>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyTableBody({
  canSync,
  hasActive,
  onClearAll,
  onSync,
}: {
  canSync: boolean;
  hasActive: boolean;
  onClearAll: () => void;
  onSync: () => void;
}) {
  if (hasActive) {
    return (
      <div className="p-4">
        <EmptyState
          icon={FileX2}
          title="Ничего не найдено"
          description="Измените фильтры, расширьте период или очистите запрос"
          action={
            <Button variant="outline" onClick={onClearAll}>
              <X />
              Очистить фильтры
            </Button>
          }
        />
      </div>
    );
  }
  return (
    <div className="p-4">
      <EmptyState
        icon={Inbox}
        title="Актов инвентаризации пока нет"
        description="Создайте акт в Quick Resto и запустите синхронизацию, чтобы увидеть его здесь."
        action={
          canSync ? (
            <Button variant="outline" onClick={onSync}>
              <RefreshCw />
              Синхронизировать QR
            </Button>
          ) : null
        }
      />
    </div>
  );
}

// ─── Mobile card ─────────────────────────────────────────────────────────────

function MobileCard({
  doc,
  staff,
  canManage,
  canViewResults,
  amountRoundingScale,
  searchActive,
}: {
  doc: DocumentListRow;
  staff: AssigneeOption[];
  canManage: boolean;
  canViewResults: boolean;
  amountRoundingScale: AmountRoundingScale;
  searchActive: boolean;
}) {
  const router = useRouter();
  const [assignSheetOpen, setAssignSheetOpen] = useState(false);
  const [reviewerSheetOpen, setReviewerSheetOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();
  const href = getDocHref(doc, canViewResults);
  const assigneeName = staff.find((m) => m.id === doc.assigned_to)?.name;
  const reviewerName = staff.find((m) => m.id === doc.reviewer_id)?.name;

  const runDelete = () => {
    startDelete(async () => {
      try {
        const result = await deleteInventoryDocument({ documentId: doc.id });
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success(`Акт № ${doc.document_number} удалён`);
        setConfirmDeleteOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось удалить акт");
      }
    });
  };

  const rowActions = useMemo(() => {
    const items: { label: string; icon: React.ReactNode; onSelect: () => void; destructive?: boolean; separatorBefore?: boolean }[] = [];
    items.push({
      label: "Открыть",
      icon: <ClipboardCheck className="h-4 w-4" />,
      onSelect: () => router.push(getDocHref(doc, canViewResults)),
    });
    if (canManage) {
      const lockReason = getAssignLockReason(doc.status);
      if (!lockReason) {
        items.push({
          label: "Изменить исполнителя",
          icon: <UserPlus className="h-4 w-4" />,
          onSelect: () => setAssignSheetOpen(true),
          separatorBefore: true,
        });
        items.push({
          label: "Изменить проверяющего",
          icon: <ShieldCheck className="h-4 w-4" />,
          onSelect: () => setReviewerSheetOpen(true),
        });
      }
      items.push({
        label: "Удалить",
        icon: <Trash2 className="h-4 w-4" />,
        destructive: true,
        separatorBefore: lockReason !== null,
        onSelect: () => setConfirmDeleteOpen(true),
      });
    }
    return items;
  }, [doc, router, canManage, canViewResults]);

  return (
    <div
      className="relative rounded-lg border bg-card p-3"
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("[data-row-interactive]")) return;
        router.push(href);
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={href} className="text-sm font-medium hover:underline" data-row-interactive>
              № {doc.document_number}
            </Link>
            <InventoryStatusBadge status={doc.status} className="text-[10px]" />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatDate(doc.invoice_date)}
            {doc.store_title ? <> · {doc.store_title}</> : null}
          </div>
          {doc.comment ? (
            <div className="mt-1 truncate text-xs text-muted-foreground">{doc.comment}</div>
          ) : null}
          {searchActive && doc.matched_ingredients && doc.matched_ingredients.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {doc.matched_ingredients.map((name) => (
                <span key={name} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800">
                  <SearchIcon className="h-2.5 w-2.5" />
                  {name}
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            <span className="text-muted-foreground">
              {doc.results_has_line_amounts
                ? `−${formatMoney(Math.abs(doc.shortfall_sum ?? 0), "RUB", amountRoundingScale)} / +${formatMoney(Math.abs(doc.surplus_sum ?? 0), "RUB", amountRoundingScale)}`
                : "—"}
            </span>
            <span className="text-muted-foreground">
              {assigneeName ? <>Исполнитель: {assigneeName}</> : "Исполнитель не назначен"}
            </span>
            {reviewerName ? (
              <span className="text-muted-foreground">Проверяющий: {reviewerName}</span>
            ) : null}
          </div>
        </div>
        <div data-row-interactive>
          <TableRowMenu actions={rowActions} />
        </div>
      </div>

      {assignSheetOpen ? (
        <div
          data-row-interactive
          className="absolute inset-x-0 bottom-0 z-10 rounded-b-lg border-t bg-background p-3 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Назначить</span>
            <button
              type="button"
              onClick={() => setAssignSheetOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <AssigneeSelect
            documentId={doc.id}
            assignedTo={doc.assigned_to}
            staff={staff}
            lockReason={getAssignLockReason(doc.status)}
          />
        </div>
      ) : null}

      {reviewerSheetOpen ? (
        <div
          data-row-interactive
          className="absolute inset-x-0 bottom-0 z-10 rounded-b-lg border-t bg-background p-3 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Проверяющий</span>
            <button
              type="button"
              onClick={() => setReviewerSheetOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <ReviewerSelect
            documentId={doc.id}
            reviewerId={doc.reviewer_id}
            staff={staff}
            lockReason={getAssignLockReason(doc.status)}
          />
        </div>
      ) : null}

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить акт № {doc.document_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              Это удалит акт и все его позиции. Если акт пришёл из Quick Resto,
              он может вернуться при следующей синхронизации.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                runDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
