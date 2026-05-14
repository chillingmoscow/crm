"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileX2,
  Inbox,
  Loader2,
  Minus,
  Plus,
  Search,
  Trash2,
  Wallet,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { Checkbox } from "@/components/ui/checkbox";
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
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { softDeleteTransaction } from "@/lib/finance/transactions";
import type {
  BankAccountGroupRow,
  BankAccountRow,
  CounterpartyGroupRow,
  CounterpartyRow,
  FinanceCategoryGroupRow,
  FinanceCategoryRow,
  TransactionListFilters,
  TransactionRow,
} from "@/types/finance";
import type {
  AccountVenueRow,
  LegalEntityRow,
} from "@/lib/org/legal-entities";

import { AmountRangeFilter } from "./filters/amount-range-filter";
import { DateRangeFilter, type DateRangeValue } from "./filters/date-range-filter";
import {
  MultiSelectFilter,
  type MultiSelectGroup,
  type MultiSelectItem,
} from "./filters/multi-select-filter";
import { TransactionFormSheet } from "./transaction-form-sheet";
import {
  formatCurrency,
  formatShortAmount,
  linkifyParts,
  splitDateTime,
} from "../_lib/utils";

const FILTERS_VISIBLE_STORAGE_KEY = "transactions.filters-visible";
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

const NO_CATEGORY_ID = "__no-category__";
const NO_COUNTERPARTY_ID = "__no-counterparty__";

const SEARCH_DEBOUNCE_MS = 350;

type Props = {
  initialTransactions: TransactionRow[];
  /** Total count from the server matching current filters (for pagination). */
  total: number;
  /** Current 1-based page from URL (already clamped server-side). */
  page: number;
  /** Current page size from URL (one of PAGE_SIZE_OPTIONS). */
  pageSize: number;
  activeLegalEntityIdFromCookie: string | null;
  /** Filters parsed server-side from URL — drives initial render and external sync. */
  filtersFromUrl: TransactionListFilters;
  /** Date preset label persisted in URL — restores button label after navigation. */
  datePresetFromUrl: string | null;
  legalEntities: LegalEntityRow[];
  /** Reserved for a future venue filter chip. */
  venues: AccountVenueRow[];
  bankAccounts: BankAccountRow[];
  bankAccountGroups: BankAccountGroupRow[];
  categories: FinanceCategoryRow[];
  categoryGroups: FinanceCategoryGroupRow[];
  counterparties: CounterpartyRow[];
  counterpartyGroups: CounterpartyGroupRow[];
  canCreate: boolean;
  canDelete: boolean;
  canExport: boolean;
};

type FormMode =
  | { kind: "closed" }
  | { kind: "create"; type: TransactionRow["type"] }
  | { kind: "edit"; transaction: TransactionRow };

export function TransactionsPage({
  initialTransactions,
  total,
  page,
  pageSize,
  activeLegalEntityIdFromCookie,
  filtersFromUrl,
  datePresetFromUrl,
  legalEntities,
  bankAccounts,
  bankAccountGroups,
  categories,
  categoryGroups,
  counterparties,
  counterpartyGroups,
  canCreate,
  canDelete,
  canExport,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const transactions = initialTransactions;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const fromIndex = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const toIndex = Math.min(page * pageSize, total);

  // ─── URL helpers ──────────────────────────────────────────────────────────

  const updateUrl = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      // Filter changes invalidate page indices — reset to page 1 unless the
      // caller is the one toggling page itself.
      const onlyPaging = Object.keys(updates).every(
        (k) => k === "page" || k === "size",
      );
      if (!onlyPaging) params.delete("page");
      const qs = params.toString();
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname);
      });
    },
    [searchParams, pathname, router],
  );

  // ─── Filter values derived from URL ───────────────────────────────────────

  // Type
  const typeValue = (filtersFromUrl.type ?? "all") as
    | "all"
    | TransactionRow["type"];

  // Date range + preset
  const dateRange: DateRangeValue = useMemo(
    () => ({
      start: filtersFromUrl.date_from ? new Date(filtersFromUrl.date_from) : null,
      end: filtersFromUrl.date_to ? new Date(filtersFromUrl.date_to) : null,
    }),
    [filtersFromUrl.date_from, filtersFromUrl.date_to],
  );

  // Multi-select arrays — sentinels reattached for UI display (not in
  // filtersFromUrl.category_id which only carries real ids).
  const accountIds = useMemo(
    () => normaliseToArray(filtersFromUrl.bank_account_id),
    [filtersFromUrl.bank_account_id],
  );

  const categoryIds = useMemo(() => {
    const real = normaliseToArray(filtersFromUrl.category_id);
    return filtersFromUrl.category_include_none ? [NO_CATEGORY_ID, ...real] : real;
  }, [filtersFromUrl.category_id, filtersFromUrl.category_include_none]);

  const counterpartyIds = useMemo(() => {
    const real = normaliseToArray(filtersFromUrl.counterparty_id);
    return filtersFromUrl.counterparty_include_none
      ? [NO_COUNTERPARTY_ID, ...real]
      : real;
  }, [filtersFromUrl.counterparty_id, filtersFromUrl.counterparty_include_none]);

  const amountRange = useMemo(
    () => ({
      min: filtersFromUrl.amount_min ?? null,
      max: filtersFromUrl.amount_max ?? null,
    }),
    [filtersFromUrl.amount_min, filtersFromUrl.amount_max],
  );

  // Search has its own draft state for typing UX, debounced into URL.
  const urlQ = filtersFromUrl.q ?? "";
  const [searchDraft, setSearchDraft] = useState(urlQ);
  const [searchExpanded, setSearchExpanded] = useState(!!urlQ);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // External URL change (e.g. user clicks chip-clear) → re-sync draft.
  useEffect(() => {
    setSearchDraft(urlQ);
  }, [urlQ]);

  // Debounced push to URL.
  useEffect(() => {
    if (searchDraft === urlQ) return;
    const t = setTimeout(() => {
      updateUrl({ q: searchDraft.trim() || null });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  // Filter-panel visibility — local UX, persisted via localStorage.
  const [filtersVisible, setFiltersVisible] = useState(true);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(FILTERS_VISIBLE_STORAGE_KEY);
      if (stored !== null) setFiltersVisible(stored === "true");
    } catch {
      // private mode etc — keep default.
    }
  }, []);
  const toggleFiltersVisibility = useCallback(() => {
    setFiltersVisible((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(FILTERS_VISIBLE_STORAGE_KEY, String(next));
      } catch {
        /* see useEffect above */
      }
      return next;
    });
  }, []);

  // ─── Selection (client-only — doesn't persist across pages) ──────────────

  const [selected, setSelected] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Reset selection when transaction list changes (page nav, filter change).
  // Stale ids could otherwise trigger bulk operations on rows the user
  // doesn't see anymore.
  const transactionIdsKey = useMemo(
    () => transactions.map((t) => t.id).join(","),
    [transactions],
  );
  useEffect(() => {
    setSelected([]);
  }, [transactionIdsKey]);

  const allOnPageSelected =
    transactions.length > 0 && transactions.every((tx) => selectedSet.has(tx.id));
  const someOnPageSelected = selected.length > 0 && !allOnPageSelected;

  const toggleAllOnPage = () => {
    if (allOnPageSelected) setSelected([]);
    else setSelected(transactions.map((tx) => tx.id));
  };

  const toggleOne = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const allSelectedSameType = useMemo(() => {
    if (selected.length <= 1) return true;
    const types = new Set(
      transactions.filter((t) => selectedSet.has(t.id)).map((t) => t.type),
    );
    return types.size === 1;
  }, [selected.length, selectedSet, transactions]);

  const selectedTotal = useMemo(() => {
    return transactions
      .filter((t) => selectedSet.has(t.id))
      .reduce((sum, t) => sum + Number(t.amount), 0);
  }, [selectedSet, transactions]);

  // ─── Bulk delete ──────────────────────────────────────────────────────────

  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const performBulkDelete = async () => {
    setBulkDeleting(true);
    const toDelete = [...selected];
    let failed = 0;
    for (const id of toDelete) {
      const { error } = await softDeleteTransaction(id);
      if (error) failed++;
    }
    setBulkDeleting(false);
    setConfirmBulkDelete(false);
    setSelected([]);
    if (failed > 0) {
      toast.error(`Не удалось удалить ${failed} из ${toDelete.length}`);
    } else {
      toast.success(`Удалено: ${toDelete.length}`);
    }
    router.refresh();
  };

  // ─── Quick lookups ────────────────────────────────────────────────────────

  const accountById = useMemo(
    () => new Map(bankAccounts.map((b) => [b.id, b] as const)),
    [bankAccounts],
  );
  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c] as const)),
    [categories],
  );
  const counterpartyById = useMemo(
    () => new Map(counterparties.map((c) => [c.id, c] as const)),
    [counterparties],
  );

  // ─── Filter dropdown source data ──────────────────────────────────────────

  const accountFilterItems: MultiSelectItem[] = useMemo(
    () =>
      bankAccounts.map((b) => ({ id: b.id, name: b.name, groupId: b.group_id })),
    [bankAccounts],
  );
  const accountFilterGroups: MultiSelectGroup[] = useMemo(
    () => bankAccountGroups.map((g) => ({ id: g.id, name: g.name })),
    [bankAccountGroups],
  );

  const categoryFilterItems: MultiSelectItem[] = useMemo(
    () => [
      { id: NO_CATEGORY_ID, name: "Без статьи", special: true },
      ...categories.map((c) => ({ id: c.id, name: c.name, groupId: c.group_id })),
    ],
    [categories],
  );
  const categoryFilterGroups: MultiSelectGroup[] = useMemo(
    () => categoryGroups.map((g) => ({ id: g.id, name: g.name })),
    [categoryGroups],
  );

  const counterpartyFilterItems: MultiSelectItem[] = useMemo(
    () => [
      { id: NO_COUNTERPARTY_ID, name: "Без контрагента", special: true },
      ...counterparties.map((c) => ({
        id: c.id,
        name: c.name,
        groupId: c.group_id,
      })),
    ],
    [counterparties],
  );
  const counterpartyFilterGroups: MultiSelectGroup[] = useMemo(
    () => counterpartyGroups.map((g) => ({ id: g.id, name: g.name })),
    [counterpartyGroups],
  );

  // ─── Active filter count + reset ──────────────────────────────────────────

  const activeFilterCount = useMemo(() => {
    let c = 0;
    if (filtersFromUrl.date_from || filtersFromUrl.date_to) c++;
    if (filtersFromUrl.type) c++;
    if (accountIds.length > 0) c++;
    if (categoryIds.length > 0) c++;
    if (counterpartyIds.length > 0) c++;
    if (filtersFromUrl.amount_min !== undefined || filtersFromUrl.amount_max !== undefined)
      c++;
    return c;
  }, [filtersFromUrl, accountIds, categoryIds, counterpartyIds]);

  const hasAnyActiveFilter = activeFilterCount > 0 || urlQ !== "";

  const resetAllFilters = () => {
    // Keep page-size preference; drop everything else.
    const keep = searchParams.get("size");
    const params = new URLSearchParams();
    if (keep) params.set("size", keep);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  const expandPeriodToYear = () => {
    const y = new Date().getFullYear();
    updateUrl({
      date_from: toIsoDate(new Date(y, 0, 1)),
      date_to: toIsoDate(new Date(y, 11, 31)),
      date_preset: "Текущий год",
    });
  };

  // ─── Form drawer (create/edit) — client-only state ────────────────────────

  const [formMode, setFormMode] = useState<FormMode>({ kind: "closed" });
  const [prefill, setPrefill] = useState<TransactionRow | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);

  const openCreate = (type: TransactionRow["type"]) => {
    setCreateMenuOpen(false);
    if (type === "transfer" && bankAccounts.length < 2) {
      toast.error("Для создания перевода необходимо иметь как минимум два счёта");
      return;
    }
    // No accounts at all → still open the form; bank-account picker has
    // an inline-create affordance that onboards the user without
    // bouncing them to /finance/accounts.
    setFormMode({ kind: "create", type });
  };

  const openEdit = (tx: TransactionRow) => {
    setFormMode({ kind: "edit", transaction: tx });
  };

  const handleCopyOne = () => {
    if (selected.length !== 1) return;
    const tx = transactions.find((t) => t.id === selected[0]);
    if (!tx) return;
    setPrefill({
      ...tx,
      description: tx.description ? `Копия: ${tx.description}` : "Копия",
    });
    setFormMode({ kind: "create", type: tx.type });
  };

  // ─── Cookie-LE notice ─────────────────────────────────────────────────────

  const cookieFilterActive =
    !filtersFromUrl.legal_entity_id &&
    !!activeLegalEntityIdFromCookie &&
    bankAccounts.some(
      (b) => b.legal_entity_id === activeLegalEntityIdFromCookie,
    );
  const cookieLEName = cookieFilterActive
    ? legalEntities.find((le) => le.id === activeLegalEntityIdFromCookie)
        ?.short_name ??
      legalEntities.find((le) => le.id === activeLegalEntityIdFromCookie)?.name ??
      null
    : null;

  // ─── Header subtitle (counter) ────────────────────────────────────────────

  const subtitle = (() => {
    if (total === 0 && !hasAnyActiveFilter) {
      return "Здесь появятся ваши приходы, расходы и переводы.";
    }
    if (hasAnyActiveFilter) {
      return `${total} ${pluralize(total, ["операция", "операции", "операций"])} за выбранный период`;
    }
    return `${total} ${pluralize(total, ["операция", "операции", "операций"])}`;
  })();

  // ─── Export href: append current URL params so filtered exports work ──────

  const exportHref = (() => {
    const qs = searchParams.toString();
    return qs
      ? `/api/finance/transactions/export?${qs}`
      : "/api/finance/transactions/export";
  })();

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 md:p-8 w-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl">Транзакции</h1>
          <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Expandable search */}
          <div className="flex items-center">
            {searchExpanded || searchDraft ? (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  autoFocus
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  onBlur={() => {
                    if (!searchDraft) setSearchExpanded(false);
                  }}
                  placeholder="Поиск по операциям…"
                  className="pl-9 pr-8 h-9 w-72"
                />
                {searchDraft && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchDraft("");
                      // Skip debounce — explicit clear, push immediately.
                      updateUrl({ q: null });
                      searchInputRef.current?.focus();
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                    aria-label="Очистить поиск"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ) : (
              <IconButton
                onClick={() => setSearchExpanded(true)}
                aria-label="Поиск"
              >
                <Search className="h-4 w-4" />
              </IconButton>
            )}
          </div>

          <IconButton
            onClick={toggleFiltersVisibility}
            // Active visual only when there are real applied filters —
            // panel-visibility alone shouldn't make the button look engaged.
            active={activeFilterCount > 0}
            badge={activeFilterCount}
            aria-label={filtersVisible ? "Скрыть фильтры" : "Показать фильтры"}
          >
            <FilterIcon />
          </IconButton>

          {canExport && (
            <IconButton asChild aria-label="Экспорт CSV">
              <a href={exportHref} download>
                <Download className="h-4 w-4" />
              </a>
            </IconButton>
          )}

          {canCreate && (
            <CreateButton
              open={createMenuOpen}
              onOpenChange={setCreateMenuOpen}
              onPick={openCreate}
              transferDisabled={bankAccounts.length < 2}
            />
          )}
        </div>
      </div>

      {/* Filter chips bar */}
      {filtersVisible && (
        <div
          className={cn(
            "mb-4 flex flex-wrap items-center gap-2 transition-opacity",
            isPending && "opacity-70",
          )}
        >
          <DateRangeFilter
            value={dateRange}
            presetLabel={datePresetFromUrl}
            onChange={(next, preset) => {
              updateUrl({
                date_from: next.start ? toIsoDate(next.start) : null,
                date_to: next.end ? toIsoDate(next.end) : null,
                date_preset: preset,
              });
            }}
          />

          <TypeFilter
            value={typeValue}
            onChange={(next) => {
              updateUrl({ type: next === "all" ? null : next });
            }}
          />

          <MultiSelectFilter
            placeholder="Счета"
            items={accountFilterItems}
            groups={accountFilterGroups}
            selectedIds={accountIds}
            onChange={(ids) => {
              updateUrl({ bank_account_id: ids.length ? ids.join(",") : null });
            }}
          />

          <MultiSelectFilter
            placeholder="Статьи"
            items={categoryFilterItems}
            groups={categoryFilterGroups}
            selectedIds={categoryIds}
            onChange={(ids) => {
              updateUrl({ category_id: ids.length ? ids.join(",") : null });
            }}
          />

          <MultiSelectFilter
            placeholder="Контрагенты"
            items={counterpartyFilterItems}
            groups={counterpartyFilterGroups}
            selectedIds={counterpartyIds}
            onChange={(ids) => {
              updateUrl({ counterparty_id: ids.length ? ids.join(",") : null });
            }}
          />

          <AmountRangeFilter
            value={amountRange}
            onChange={(next) => {
              updateUrl({
                amount_min: next.min !== null ? String(next.min) : null,
                amount_max: next.max !== null ? String(next.max) : null,
              });
            }}
          />

          {urlQ && (
            <Chip
              label={`Поиск: «${urlQ}»`}
              onClear={() => {
                setSearchDraft("");
                updateUrl({ q: null });
              }}
            />
          )}

          {hasAnyActiveFilter && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetAllFilters}
              className="rounded-full h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              Очистить все
            </Button>
          )}
        </div>
      )}

      {cookieLEName && (
        <p className="text-xs text-muted-foreground mb-2">
          Активное юрлицо:{" "}
          <span className="text-foreground font-medium">{cookieLEName}</span>{" "}
          — переключатель в шапке.
        </p>
      )}

      {/* Table / empty / no-results */}
      <div
        className={cn(
          "rounded-lg border bg-background overflow-hidden transition-opacity",
          isPending && "opacity-70",
        )}
      >
        {transactions.length === 0 ? (
          !hasAnyActiveFilter ? (
            <EmptyAllState
              canCreate={canCreate}
              onCreate={(type) => openCreate(type)}
            />
          ) : (
            <NoResultsState
              hasSearch={urlQ !== ""}
              hasDateFilter={!!(dateRange.start || dateRange.end)}
              onClearSearch={() => {
                setSearchDraft("");
                updateUrl({ q: null });
              }}
              onExpandPeriod={expandPeriodToYear}
              onResetAll={resetAllFilters}
            />
          )
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="bg-muted/40">
              {selected.length > 0 ? (
                <tr className="h-11 bg-brand/10">
                  <th className="px-3 w-12">
                    <Checkbox
                      checked={
                        allOnPageSelected
                          ? true
                          : someOnPageSelected
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={toggleAllOnPage}
                      className="data-[state=checked]:bg-brand data-[state=checked]:border-brand data-[state=indeterminate]:bg-brand data-[state=indeterminate]:border-brand"
                    />
                  </th>
                  <th colSpan={5} className="text-left px-2">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-brand">
                        {selected.length}{" "}
                        {pluralize(selected.length, [
                          "выбрана",
                          "выбрано",
                          "выбрано",
                        ])}
                      </span>
                      <span className="text-xs text-brand/80">
                        на сумму {formatCurrency(selectedTotal, "RUB")}
                      </span>
                      <div className="ml-auto flex items-center gap-2 mr-2">
                        {selected.length === 1 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs"
                            onClick={handleCopyOne}
                          >
                            Копировать
                          </Button>
                        )}
                        {allSelectedSameType && selected.length === 1 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs"
                            onClick={() => {
                              const tx = transactions.find(
                                (t) => t.id === selected[0],
                              );
                              if (tx) openEdit(tx);
                            }}
                          >
                            Редактировать
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-8 text-xs"
                            onClick={() => setConfirmBulkDelete(true)}
                          >
                            <Trash2 />
                            Удалить
                          </Button>
                        )}
                      </div>
                    </div>
                  </th>
                </tr>
              ) : (
                <tr className="h-10 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 w-12">
                    <Checkbox
                      checked={
                        allOnPageSelected
                          ? true
                          : someOnPageSelected
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={toggleAllOnPage}
                      className="data-[state=checked]:bg-brand data-[state=checked]:border-brand data-[state=indeterminate]:bg-brand data-[state=indeterminate]:border-brand"
                    />
                  </th>
                  <th className="px-3 font-medium" style={{ width: "12%" }}>
                    Дата
                  </th>
                  <th className="px-3 font-medium" style={{ width: "16%" }}>
                    Сумма
                  </th>
                  <th className="px-3 font-medium" style={{ width: "30%" }}>
                    Статья и описание
                  </th>
                  <th className="px-3 font-medium" style={{ width: "20%" }}>
                    Контрагент
                  </th>
                  <th className="px-3 font-medium" style={{ width: "22%" }}>
                    Счёт
                  </th>
                </tr>
              )}
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <Row
                  key={tx.id}
                  tx={tx}
                  isSelected={selectedSet.has(tx.id)}
                  onToggle={() => toggleOne(tx.id)}
                  onClick={() => openEdit(tx)}
                  accountById={accountById}
                  categoryById={categoryById}
                  counterpartyById={counterpartyById}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-muted-foreground">
            Строк на странице:{" "}
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                updateUrl({ size: v, page: null });
              }}
            >
              <SelectTrigger className="inline-flex w-auto h-7 px-2 mx-1 align-middle">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="ml-2 tabular-nums">
              {fromIndex}–{toIndex} из {total}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-sm tabular-nums text-muted-foreground mr-2">
              Стр. {page} из {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                updateUrl({ page: String(Math.max(1, page - 1)) })
              }
              disabled={page <= 1 || isPending}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                updateUrl({ page: String(Math.min(totalPages, page + 1)) })
              }
              disabled={page >= totalPages || isPending}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Bulk-delete confirmation — AlertDialog primitive. Копи без
          «30 дней» — реального retention в БД нет, soft-delete просто
          скрывает запись от read-фильтров, восстановление доступно
          всегда через журнал изменений. */}
      <AlertDialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <Trash2 className="h-4 w-4" />
              </span>
              {selected.length > 1 ? "Удалить выбранные операции" : "Удалить операцию"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selected.length > 1
                ? `Будут удалены ${selected.length} ${pluralize(selected.length, ["операция", "операции", "операций"])} на общую сумму ${formatCurrency(selectedTotal, "RUB")}. Восстановить операции можно из истории изменений.`
                : "Операция будет удалена из текущего журнала. Восстановить её можно из истории изменений."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                performBulkDelete();
              }}
              disabled={bulkDeleting}
              className={buttonVariants({ variant: "destructive" })}
            >
              {bulkDeleting && <Loader2 className="animate-spin" />}
              <Trash2 />
              Удалить{selected.length > 1 ? ` ${selected.length}` : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Right-sidebar form */}
      <TransactionFormSheet
        mode={formMode}
        prefill={prefill}
        onClose={() => {
          setFormMode({ kind: "closed" });
          setPrefill(null);
        }}
        onSaved={() => {
          setFormMode({ kind: "closed" });
          setPrefill(null);
          router.refresh();
        }}
        onTypeChange={(t) => {
          if (formMode.kind === "create") setFormMode({ kind: "create", type: t });
        }}
        legalEntities={legalEntities}
        bankAccounts={bankAccounts}
        categories={categories}
        counterparties={counterparties}
        canDelete={canDelete}
      />
    </div>
  );
}

// ─── Header subcomponents ────────────────────────────────────────────────────

function IconButton({
  children,
  onClick,
  active,
  badge,
  asChild,
  ...rest
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  badge?: number;
  asChild?: boolean;
} & React.HTMLAttributes<HTMLElement>) {
  const className = cn(
    "relative inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-background text-muted-foreground hover:bg-muted transition-colors",
    active && "bg-brand/10 border-brand/20 text-brand",
  );
  const tooltipLabel =
    typeof rest["aria-label"] === "string" ? rest["aria-label"] : undefined;
  const inner = asChild ? (
    <span className={className} {...rest}>
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full border-2 border-background bg-destructive text-[10px] font-semibold text-destructive-foreground">
          {badge}
        </span>
      )}
    </span>
  ) : (
    <button type="button" onClick={onClick} className={className} {...rest}>
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full border-2 border-background bg-destructive text-[10px] font-semibold text-destructive-foreground">
          {badge}
        </span>
      )}
    </button>
  );
  return tooltipLabel ? (
    <IconTooltip label={tooltipLabel}>{inner}</IconTooltip>
  ) : (
    inner
  );
}

function FilterIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

function CreateButton({
  open,
  onOpenChange,
  onPick,
  transferDisabled,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (type: TransactionRow["type"]) => void;
  transferDisabled: boolean;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button className="h-9 gap-1.5">
          <Plus className="h-4 w-4" />
          Добавить операцию
          <ChevronDown className="h-4 w-4 opacity-80" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <button
          type="button"
          onClick={() => onPick("income")}
          className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent"
        >
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
            <Plus className="h-3.5 w-3.5" />
          </span>
          Приход
        </button>
        <button
          type="button"
          onClick={() => onPick("expense")}
          className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent"
        >
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">
            <Minus className="h-3.5 w-3.5" />
          </span>
          Расход
        </button>
        <button
          type="button"
          onClick={() => onPick("transfer")}
          disabled={transferDisabled}
          className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent"
        >
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand/10 text-brand">
            <ArrowLeftRight className="h-3.5 w-3.5" />
          </span>
          Перевод
        </button>
      </PopoverContent>
    </Popover>
  );
}

// ─── Type filter ─────────────────────────────────────────────────────────────

function TypeFilter({
  value,
  onChange,
}: {
  value: "all" | TransactionRow["type"];
  onChange: (v: "all" | TransactionRow["type"]) => void;
}) {
  const options: { value: "all" | TransactionRow["type"]; label: string }[] = [
    { value: "all",      label: "Все типы" },
    { value: "income",   label: "Приход" },
    { value: "expense",  label: "Расход" },
    { value: "transfer", label: "Переводы" },
  ];
  const active = value !== "all";
  const label = options.find((o) => o.value === value)?.label ?? "Тип";
  return (
    <Popover>
      <div className="relative inline-flex">
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-8 rounded-full pl-3 pr-8 font-normal text-sm",
              active
                ? "bg-brand/10 border-brand/20 text-brand hover:bg-brand/15 hover:text-brand"
                : "bg-muted/60 border-transparent text-muted-foreground hover:bg-muted",
            )}
          >
            <span>{label}</span>
            {!active && <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" />}
          </Button>
        </PopoverTrigger>
        {active && (
          <button
            type="button"
            aria-label="Сбросить тип"
            onClick={(e) => {
              e.stopPropagation();
              onChange("all");
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-brand text-brand-foreground hover:bg-brand/90"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <PopoverContent align="start" className="w-44 p-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "block w-full rounded-sm px-3 py-2 text-sm text-left hover:bg-accent",
              o.value === value && "bg-accent",
            )}
          >
            {o.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 border border-brand/20 text-brand text-sm pl-3 pr-1.5 py-0.5 h-8">
      <span className="truncate max-w-[200px]">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label="Очистить"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-brand text-brand-foreground hover:bg-brand/90"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// ─── Empty / no-results states ───────────────────────────────────────────────

function EmptyAllState({
  canCreate,
  onCreate,
}: {
  canCreate: boolean;
  onCreate: (type: TransactionRow["type"]) => void;
}) {
  return (
    <EmptyState
      icon={Inbox}
      title="У вас пока нет операций"
      description="Нажмите «Добавить операцию» в правом верхнем углу, чтобы создать первый приход, расход или перевод."
      action={
        canCreate ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onCreate("income")}>
              <Plus className="text-green-600" />
              Приход
            </Button>
            <Button variant="outline" onClick={() => onCreate("expense")}>
              <Minus className="text-destructive" />
              Расход
            </Button>
          </div>
        ) : null
      }
    />
  );
}

function NoResultsState({
  hasSearch,
  hasDateFilter,
  onClearSearch,
  onExpandPeriod,
  onResetAll,
}: {
  hasSearch: boolean;
  hasDateFilter: boolean;
  onClearSearch: () => void;
  onExpandPeriod: () => void;
  onResetAll: () => void;
}) {
  return (
    <EmptyState
      icon={FileX2}
      title="Ничего не найдено"
      description="Попробуйте изменить запрос, расширить период или сбросить активные фильтры."
      action={
        <div className="flex items-center gap-2 flex-wrap justify-center">
          {hasSearch && (
            <Button variant="outline" onClick={onClearSearch}>
              <X />
              Очистить поиск
            </Button>
          )}
          {hasDateFilter && (
            <Button variant="outline" onClick={onExpandPeriod}>
              Расширить период
            </Button>
          )}
          <Button onClick={onResetAll}>Сбросить все фильтры</Button>
        </div>
      }
    />
  );
}

// ─── Table row ──────────────────────────────────────────────────────────────

function Row({
  tx,
  isSelected,
  onToggle,
  onClick,
  accountById,
  categoryById,
  counterpartyById,
}: {
  tx: TransactionRow;
  isSelected: boolean;
  onToggle: () => void;
  onClick: () => void;
  accountById: Map<string, BankAccountRow>;
  categoryById: Map<string, FinanceCategoryRow>;
  counterpartyById: Map<string, CounterpartyRow>;
}) {
  const account = accountById.get(tx.bank_account_id);
  const toAccount = tx.to_bank_account_id ? accountById.get(tx.to_bank_account_id) : null;
  const category = tx.category_id ? categoryById.get(tx.category_id) : null;
  const counterparty = tx.counterparty_id ? counterpartyById.get(tx.counterparty_id) : null;

  const amount = Number(tx.amount);
  const sign = tx.type === "income" ? "+" : tx.type === "expense" ? "−" : "";
  // Semantic income/expense palette per DS — green-700 / red-700 in light;
  // dark mode is handled by lighter shades on the same scale.
  const amountClass =
    tx.type === "income"
      ? "text-green-700 dark:text-green-400"
      : tx.type === "expense"
        ? "text-red-700 dark:text-red-400"
        : "text-foreground";

  const { date, time } = splitDateTime(tx.date, tx.created_at);

  return (
    <tr
      onClick={onClick}
      className={cn(
        "h-14 cursor-pointer border-t transition-colors",
        "hover:bg-accent/40",
        isSelected && "bg-brand/5",
      )}
    >
      <td className="px-3 align-middle" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
          className="data-[state=checked]:bg-brand data-[state=checked]:border-brand"
        />
      </td>
      <td className="px-3 align-middle whitespace-nowrap">
        <div className="flex items-center gap-1.5 text-sm">
          <span>{date}</span>
          {time && <span className="text-muted-foreground text-xs">· {time}</span>}
        </div>
      </td>
      <td className={cn("px-3 align-middle font-medium tabular-nums", amountClass)}>
        {sign}
        {formatCurrency(amount, tx.currency)}
      </td>
      <td className="px-3 align-middle">
        {tx.type === "transfer" ? (
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="h-3.5 w-3.5 text-zinc-400" />
              <span className="text-sm">Перевод между счетами</span>
            </div>
            {tx.description && <DescriptionLine text={tx.description} />}
          </div>
        ) : (
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: category?.color ?? "#cccccc" }}
              />
              <span className="text-sm truncate">
                {category?.name ?? "Без статьи"}
              </span>
            </div>
            {tx.description && <DescriptionLine text={tx.description} />}
          </div>
        )}
      </td>
      <td className="px-3 align-middle">
        {counterparty ? (
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted shrink-0">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <span className="text-sm truncate max-w-[160px]">{counterparty.name}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 align-middle">
        {tx.type === "transfer" && toAccount ? (
          <div className="flex flex-col gap-0.5">
            <AccountLine account={account} />
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <ArrowLeftRight className="h-3 w-3" />
              <span className="truncate">{toAccount.name}</span>
            </div>
          </div>
        ) : (
          <AccountLine account={account} showBalance />
        )}
      </td>
    </tr>
  );
}

function AccountLine({
  account,
  showBalance,
}: {
  account: BankAccountRow | undefined;
  showBalance?: boolean;
}) {
  if (!account)
    return <span className="text-muted-foreground text-sm">Неизвестный счёт</span>;
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5">
        <Wallet className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm truncate max-w-[180px]">{account.name}</span>
      </div>
      {showBalance && (
        <span className="text-xs text-muted-foreground tabular-nums pl-5">
          {formatShortAmount(Number(account.balance), account.currency)}
        </span>
      )}
    </div>
  );
}

function DescriptionLine({ text }: { text: string }) {
  const parts = linkifyParts(text);
  return (
    <p className="text-xs text-muted-foreground leading-tight mt-0.5 truncate">
      {parts.map((p, i) =>
        p.type === "link" ? (
          <a
            key={i}
            href={p.value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand underline"
            onClick={(e) => e.stopPropagation()}
          >
            {p.value}
          </a>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </p>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Russian plural form: pluralize(1, ["a","b","c"]) → "a"; (3,…) → "b"; (5,…) → "c" */
function pluralize(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

function normaliseToArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  if (Array.isArray(v)) return v;
  return v ? [v] : [];
}

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
