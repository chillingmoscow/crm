"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ClipboardCheck,
  FileX2,
  Inbox,
  Loader2,
  RefreshCw,
  Search as SearchIcon,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { formatMoney, type AmountRoundingScale } from "@/lib/format/amount";
import { DateRangeFilter, type DateRangeValue } from "@/components/shared/date-range-filter";
import {
  TableControlPin,
  TableControls,
  TablePageHeader,
  TablePagination,
  TableRowMenu,
  TableSplitButton,
} from "@/components/shared/table";
import { syncQuickRestoInventory } from "@/app/(dashboard)/inventory/actions";
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client";

import { AssigneeSelect, type AssigneeOption } from "./assignee-select";
import {
  DEFAULT_SORT,
  DOCUMENT_SORT_MODES,
  DOCUMENT_STATUSES,
  type DocumentListRow,
  type DocumentSortMode,
  type DocumentStatus,
  type ListDocumentsFilters,
  type ListDocumentsResult,
} from "@/lib/inventory/list-documents-shared";

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<DocumentStatus, string> = {
  synced: "Новый",
  assigned: "Назначен",
  in_progress: "В работе",
  ready_for_review: "Готов к проверке",
  processed: "Проведен",
  results_blocked: "Итоги требуют проверки",
  sync_error: "Ошибка синхронизации",
};

const STATUS_BADGE_CLASS: Record<DocumentStatus, string> = {
  synced:           "bg-slate-100 text-slate-700 border-slate-200",
  assigned:         "bg-blue-50 text-blue-700 border-blue-200",
  in_progress:      "bg-amber-50 text-amber-700 border-amber-200",
  ready_for_review: "bg-violet-50 text-violet-700 border-violet-200",
  processed:        "bg-emerald-50 text-emerald-700 border-emerald-200",
  results_blocked:  "bg-rose-50 text-rose-700 border-rose-200",
  sync_error:       "bg-rose-50 text-rose-700 border-rose-200",
};

const SORT_LABEL: Record<DocumentSortMode, string> = {
  date_desc:   "Дата ↓",
  date_asc:    "Дата ↑",
  number_desc: "№ ↓",
  number_asc:  "№ ↑",
  status:      "По статусу",
};

const SEARCH_DEBOUNCE_MS = 250;

// ─── Props ───────────────────────────────────────────────────────────────────

export type VenueOption = { id: string; name: string };
export type StoreOption = { id: string; title: string };

type Props = {
  initial: ListDocumentsResult;
  filtersFromUrl: ListDocumentsFilters;
  sortFromUrl: DocumentSortMode;
  pageFromUrl: number;
  pageSizeFromUrl: number;
  datePresetFromUrl: string | null;
  venues: VenueOption[];
  stores: StoreOption[];
  staff: AssigneeOption[];
  accountId: string;
  canManage: boolean;
  canSync: boolean;
  amountRoundingScale: AmountRoundingScale;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDocHref(doc: Pick<DocumentListRow, "id" | "processed" | "results_has_line_amounts" | "status">) {
  if (doc.processed || doc.results_has_line_amounts || doc.status === "results_blocked") {
    return `/documents/${doc.id}/results`;
  }
  return `/documents/${doc.id}`;
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
  // local ISO date without timezone shift (yyyy-mm-dd)
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
  amountRoundingScale,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(filtersFromUrl.q ?? "");
  const [searchOpen, setSearchOpen] = useState(Boolean(filtersFromUrl.q));
  const [isSyncing, startSyncTransition] = useTransition();

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

  // Debounced search → URL
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (search === (filtersFromUrl.q ?? "")) return;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      const trimmed = search.trim();
      updateUrl({ q: trimmed.length >= 2 ? trimmed : null }, { resetPage: true });
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

  const onSortChange = (sort: DocumentSortMode) =>
    updateUrl({ sort: sort === DEFAULT_SORT ? null : sort }, { resetPage: true });

  const onClearAll = () => {
    setSearch("");
    router.replace(pathname);
  };

  const hasActiveControls =
    (filtersFromUrl.venue && filtersFromUrl.venue !== "all") ||
    (filtersFromUrl.status && filtersFromUrl.status.length > 0) ||
    (filtersFromUrl.assigned && filtersFromUrl.assigned !== "any") ||
    (filtersFromUrl.store && filtersFromUrl.store.length > 0) ||
    Boolean(filtersFromUrl.date_from || filtersFromUrl.date_to) ||
    Boolean(filtersFromUrl.q) ||
    sortFromUrl !== DEFAULT_SORT;

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

  // ── Header click → sort cycle ──────────────────────────────
  const cycleSort = (column: "document_number" | "invoice_date" | "status") => {
    const mapping: Record<string, DocumentSortMode[]> = {
      invoice_date:    ["date_desc", "date_asc"],
      document_number: ["number_desc", "number_asc"],
      status:          ["status", "status"],
    };
    const variants = mapping[column];
    const idx = variants.indexOf(sortFromUrl);
    const next =
      idx === -1
        ? variants[0]
        : idx === variants.length - 1
          ? DEFAULT_SORT
          : variants[idx + 1];
    onSortChange(next);
  };

  const sortIndicator = (column: "document_number" | "invoice_date" | "status") => {
    if (column === "invoice_date" && sortFromUrl === "date_desc") return <ArrowDown className="h-3 w-3" />;
    if (column === "invoice_date" && sortFromUrl === "date_asc")  return <ArrowUp className="h-3 w-3" />;
    if (column === "document_number" && sortFromUrl === "number_desc") return <ArrowDown className="h-3 w-3" />;
    if (column === "document_number" && sortFromUrl === "number_asc")  return <ArrowUp className="h-3 w-3" />;
    if (column === "status" && sortFromUrl === "status") return <ArrowDown className="h-3 w-3" />;
    return null;
  };

  const rows = initial.rows;
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

  return (
    <div className="w-full space-y-4 px-4 py-4 md:px-8 md:py-6">
      <TablePageHeader
        title="Акты инвентаризации"
        subtitle="Заполнение, итоги и пересорт по строкам Quick Resto."
        actions={
          <TableControls
            search={{
              value: search,
              onChange: setSearch,
              open: searchOpen,
              onOpenChange: setSearchOpen,
              placeholder: "Поиск",
            }}
            sort={{
              active: sortFromUrl !== DEFAULT_SORT,
              content: <SortPanel value={sortFromUrl} onChange={onSortChange} />,
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

      {/* Filter pins row — всегда видимая, как в финансах */}
      <div className="flex flex-wrap items-center gap-2">
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

        <TableControlPin
          active={(filtersFromUrl.status?.length ?? 0) > 0}
          label={statusPinLabel(filtersFromUrl.status)}
          onClear={
            (filtersFromUrl.status?.length ?? 0) > 0
              ? () => onStatusToggle(filtersFromUrl.status![0])
              : undefined
          }
          clearLabel="Сбросить статус"
        >
          <StatusPicker value={filtersFromUrl.status ?? []} onToggle={onStatusToggle} />
        </TableControlPin>

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

        <DateRangeFilter
          value={dateRange}
          presetLabel={datePresetFromUrl}
          onChange={onDateRangeChange}
        />

        {hasActiveControls ? (
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

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-lg border bg-background md:block">
        <table className="w-full table-fixed">
          <thead className="bg-muted/40 text-xs font-medium tracking-wide text-muted-foreground">
            <tr>
              <SortableTh label="Номер"      width={110} onClick={() => cycleSort("document_number")} indicator={sortIndicator("document_number")} />
              <SortableTh label="Дата"       width={110} onClick={() => cycleSort("invoice_date")}    indicator={sortIndicator("invoice_date")} />
              <SortableTh label="Статус"     width={170} onClick={() => cycleSort("status")}          indicator={sortIndicator("status")} />
              <th className="px-3 py-3 text-left" style={{ width: 200 }}>Склад</th>
              <th className="px-3 py-3 text-left" style={{ width: 240 }}>Комментарий</th>
              <th className="px-3 py-3 text-left" style={{ width: 200 }}>Итоги</th>
              <th className="px-3 py-3 text-left" style={{ width: 200 }}>Назначен</th>
              <th className="w-14 px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-0">
                  <EmptyTableBody
                    canSync={canSync}
                    hasActive={hasActiveControls}
                    onClearAll={onClearAll}
                    onSync={() => runSync("documents")}
                  />
                </td>
              </tr>
            ) : (
              rows.map((doc) => (
                <DesktopRow
                  key={doc.id}
                  doc={doc}
                  staff={staff}
                  canManage={canManage}
                  amountRoundingScale={amountRoundingScale}
                  searchActive={Boolean(filtersFromUrl.q)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="grid gap-2 md:hidden">
        {rows.length === 0 ? (
          <EmptyTableBody
            canSync={canSync}
            hasActive={hasActiveControls}
            onClearAll={onClearAll}
            onSync={() => runSync("documents")}
          />
        ) : (
          rows.map((doc) => (
            <MobileCard
              key={doc.id}
              doc={doc}
              staff={staff}
              canManage={canManage}
              amountRoundingScale={amountRoundingScale}
              searchActive={Boolean(filtersFromUrl.q)}
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

function SortPanel({
  value,
  onChange,
}: {
  value: DocumentSortMode;
  onChange: (s: DocumentSortMode) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="px-3 pb-1 pt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        Сортировка
      </p>
      {DOCUMENT_SORT_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={cn(
            "block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent",
            mode === value ? "bg-accent text-foreground" : "text-muted-foreground",
          )}
        >
          {SORT_LABEL[mode]}
        </button>
      ))}
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
          description="Измените фильтры, расширьте период или очистите запрос."
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

// ─── Desktop row ─────────────────────────────────────────────────────────────

function DesktopRow({
  doc,
  staff,
  canManage,
  amountRoundingScale,
  searchActive,
}: {
  doc: DocumentListRow;
  staff: AssigneeOption[];
  canManage: boolean;
  amountRoundingScale: AmountRoundingScale;
  searchActive: boolean;
}) {
  const router = useRouter();
  const href = getDocHref(doc);
  const statusKey = doc.status as DocumentStatus;

  const rowMenuActions = useMemo(() => {
    const items: { label: string; icon: React.ReactNode; onSelect: () => void; separatorBefore?: boolean }[] = [];
    if (doc.processed || doc.results_has_line_amounts || doc.status === "results_blocked") {
      items.push({ label: "Перейти к итогам",     icon: <CheckCircle2 className="h-4 w-4" />,   onSelect: () => router.push(`/documents/${doc.id}/results`) });
      items.push({ label: "Перейти к заполнению", icon: <ClipboardCheck className="h-4 w-4" />, onSelect: () => router.push(`/documents/${doc.id}`) });
    } else {
      items.push({ label: "Открыть акт",          icon: <ClipboardCheck className="h-4 w-4" />, onSelect: () => router.push(`/documents/${doc.id}`) });
    }
    return items;
  }, [doc, router]);

  const onRowClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-row-interactive]")) return;
    router.push(href);
  };

  return (
    <tr
      onClick={onRowClick}
      className="cursor-pointer border-b last:border-b-0 hover:bg-muted/30"
    >
      <td className="px-3 py-3 align-top">
        <Link
          href={href}
          className="text-sm font-medium hover:underline"
          data-row-interactive
          onClick={(e) => e.stopPropagation()}
        >
          № {doc.document_number}
        </Link>
        {searchActive && doc.matched_ingredients && doc.matched_ingredients.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {doc.matched_ingredients.map((name) => (
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
      </td>
      <td className="px-3 py-3 align-top text-sm">{formatDate(doc.invoice_date)}</td>
      <td className="px-3 py-3 align-top">
        <Badge
          variant="outline"
          className={cn(
            "text-xs font-normal",
            STATUS_BADGE_CLASS[statusKey] ?? "bg-slate-50 text-slate-700 border-slate-200",
          )}
        >
          {STATUS_LABEL[statusKey] ?? doc.status}
        </Badge>
      </td>
      <td className="truncate px-3 py-3 align-top text-sm">{doc.store_title ?? "—"}</td>
      <td className="px-3 py-3 align-top">
        <span className="block truncate text-sm text-muted-foreground" title={doc.comment ?? undefined}>
          {doc.comment ?? "—"}
        </span>
      </td>
      <td className="px-3 py-3 align-top text-sm">
        {doc.results_has_line_amounts ? (
          <span>
            −{formatMoney(Math.abs(doc.shortfall_sum ?? 0), "RUB", amountRoundingScale)} / +{formatMoney(Math.abs(doc.surplus_sum ?? 0), "RUB", amountRoundingScale)}
          </span>
        ) : (
          <span className="text-amber-700">Нет построчных итогов</span>
        )}
      </td>
      <td className="px-3 py-3 align-top" data-row-interactive onClick={(e) => e.stopPropagation()}>
        {canManage ? (
          <AssigneeSelect documentId={doc.id} assignedTo={doc.assigned_to} staff={staff} />
        ) : (
          <span className="text-sm text-muted-foreground">
            {staff.find((m) => m.id === doc.assigned_to)?.name ?? "—"}
          </span>
        )}
      </td>
      <td className="w-14 px-3 py-3 text-right align-top" data-row-interactive onClick={(e) => e.stopPropagation()}>
        <TableRowMenu actions={rowMenuActions} />
      </td>
    </tr>
  );
}

// ─── Mobile card ─────────────────────────────────────────────────────────────

function MobileCard({
  doc,
  staff,
  canManage,
  amountRoundingScale,
  searchActive,
}: {
  doc: DocumentListRow;
  staff: AssigneeOption[];
  canManage: boolean;
  amountRoundingScale: AmountRoundingScale;
  searchActive: boolean;
}) {
  const router = useRouter();
  const [assignSheetOpen, setAssignSheetOpen] = useState(false);
  const href = getDocHref(doc);
  const statusKey = doc.status as DocumentStatus;
  const assigneeName = staff.find((m) => m.id === doc.assigned_to)?.name;

  const rowActions = useMemo(() => {
    const items: { label: string; icon: React.ReactNode; onSelect: () => void; separatorBefore?: boolean }[] = [];
    if (doc.processed || doc.results_has_line_amounts || doc.status === "results_blocked") {
      items.push({ label: "Перейти к итогам",     icon: <CheckCircle2 className="h-4 w-4" />,   onSelect: () => router.push(`/documents/${doc.id}/results`) });
      items.push({ label: "Перейти к заполнению", icon: <ClipboardCheck className="h-4 w-4" />, onSelect: () => router.push(`/documents/${doc.id}`) });
    } else {
      items.push({ label: "Открыть акт",          icon: <ClipboardCheck className="h-4 w-4" />, onSelect: () => router.push(`/documents/${doc.id}`) });
    }
    if (canManage) {
      items.push({
        label: "Изменить назначение",
        icon: <UserPlus className="h-4 w-4" />,
        onSelect: () => setAssignSheetOpen(true),
        separatorBefore: true,
      });
    }
    return items;
  }, [doc, router, canManage]);

  return (
    <div
      className="relative rounded-lg border bg-background p-3"
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
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-normal",
                STATUS_BADGE_CLASS[statusKey] ?? "bg-slate-50 text-slate-700 border-slate-200",
              )}
            >
              {STATUS_LABEL[statusKey] ?? doc.status}
            </Badge>
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
                : "Нет построчных итогов"}
            </span>
            <span className="text-muted-foreground">
              {assigneeName ? <>Назначен: {assigneeName}</> : "Не назначен"}
            </span>
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
          <AssigneeSelect documentId={doc.id} assignedTo={doc.assigned_to} staff={staff} />
        </div>
      ) : null}
    </div>
  );
}

// ─── Utility cell components ─────────────────────────────────────────────────

function SortableTh({
  label,
  width,
  onClick,
  indicator,
}: {
  label: string;
  width: number;
  onClick: () => void;
  indicator: React.ReactNode;
}) {
  return (
    <th className="px-3 py-3 text-left" style={{ width }}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        <span>{label}</span>
        {indicator}
      </button>
    </th>
  );
}
