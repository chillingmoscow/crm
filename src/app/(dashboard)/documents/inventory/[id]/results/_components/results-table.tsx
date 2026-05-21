"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Ban,
  Check,
  CheckCircle2,
  Lock,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Plus,
  Repeat2,
  RotateCcw,
  Search as SearchIcon,
  Trash2,
  Undo2,
  WandSparkles,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
  createInventoryResultExclusionRule,
  createInventoryResultResort,
  deleteInventoryResultExclusionRule,
  dismissInventoryResortSuggestion,
  finalizeInventoryResults,
  reopenInventoryResults,
  returnDocumentForRecount,
  setInventoryResultItemExcluded,
  setRecountFlag,
  updateInventoryResultComment,
  voidInventoryResultResort,
} from "@/app/(dashboard)/inventory/actions";
import {
  calculateManagementTotals,
  type InventoryResortAllocationItem,
} from "@/lib/inventory/results";
import {
  formatAmount,
  formatMoney,
  formatSignedMoney,
  type AmountRoundingScale,
} from "@/lib/format/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TableBulkBar, TableControls, TableControlPin } from "@/components/shared/table";
import { cn } from "@/lib/utils";
import { RefreshResultsButton } from "./refresh-results-button";

export type InventoryDocumentResultItem = {
  id: string;
  ingredient_id: string | null;
  external_product_id: string | null;
  product_name: string;
  article: string | null;
  measure_unit_id: number | null;
  measure_unit_name: string | null;
  actual_amount: number | null;
  calculated_amount: number | null;
  difference_amount: number | null;
  prime_cost: number | null;
  difference_sum: number | null;
  excluded_from_totals: boolean | null;
  exclude_reason: string | null;
  result_comment: string | null;
  group_id: string | null;
  group_name: string | null;
  exclusion_rule_id: string | null;
  exclusion_rule_reason: string | null;
  needs_recount: boolean | null;
  recount_auto_flagged: boolean | null;
  recount_note: string | null;
};

export type InventoryResultResortRow = {
  id: string;
  status: string;
  reason: string;
  group_name: string | null;
  offset_amount: number | null;
  residual_shortfall_sum: number | null;
  residual_surplus_sum: number | null;
  /** Корректировка себестоимости (миграция 205). Управленческий
      убыток на разнице цен покрытия пересорта. >= 0. */
  cost_adjustment_sum: number | null;
  suggestion_source: string | null;
  created_at: string;
  void_reason: string | null;
};

export type InventoryResultResortItemRow = InventoryResortAllocationItem & {
  resortId: string;
  documentItemId: string;
};

export type InventoryResultEventRow = {
  id: string;
  event_type: string;
  message: string;
  created_at: string;
  created_by: string | null;
  payload?: unknown;
  actor?: {
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
  } | null;
};

export type InventoryResortSuggestion = {
  key: string;
  itemIds: string[];
  title: string;
  reason: string;
  confidence: number;
  source: "history" | "ai";
};

type Props = {
  documentId: string;
  items: InventoryDocumentResultItem[];
  resorts: InventoryResultResortRow[];
  resortItems: InventoryResultResortItemRow[];
  suggestions: InventoryResortSuggestion[];
  amountRoundingScale: AmountRoundingScale;
  isFinalized: boolean;
  canComment: boolean;
  canAdjust: boolean;
  canFinalize: boolean;
  canRecount: boolean;
  aiSuggestionsEnabled: boolean;
  documentStatus: string;
};

type ResultColumnKey = "calculated" | "fact" | "difference" | "management" | "status" | "recount" | "comment";
type ResultStatusFilter = "all" | "included" | "excluded" | "resort";

// Multi-sort 1-в-1 с эталоном documents-table.tsx / form-editor: поле +
// направление в combined-значении, sorts — массив (порядок = приоритет).
type ResultSortField = "name" | "group" | "empty" | "sum";
type ResultSortMode =
  | "name_asc"  | "name_desc"
  | "group_asc" | "group_desc"
  | "empty_first" | "empty_last"
  | "sum_asc" | "sum_desc";

const RESULT_SORT_FIELDS: ResultSortField[] = ["name", "group", "empty", "sum"];

const RESULT_SORT_FIELD_LABEL: Record<ResultSortField, string> = {
  name:  "Название",
  group: "Группа",
  empty: "Заполненность",
  sum:   "Сумма расхождения",
};

const RESULT_STATUS_LABEL: Record<ResultStatusFilter, string> = {
  all:      "Все",
  included: "Учитывать",
  excluded: "Не учитывать",
  resort:   "Пересорт",
};

function resultSortToField(mode: ResultSortMode): ResultSortField {
  if (mode === "name_asc"  || mode === "name_desc")  return "name";
  if (mode === "group_asc" || mode === "group_desc") return "group";
  if (mode === "empty_first" || mode === "empty_last") return "empty";
  return "sum";
}

function resultSortToDirection(mode: ResultSortMode): "asc" | "desc" {
  if (mode === "empty_first") return "asc";
  if (mode === "empty_last")  return "desc";
  return mode.endsWith("_asc") ? "asc" : "desc";
}

function combineResultSort(field: ResultSortField, direction: "asc" | "desc"): ResultSortMode {
  if (field === "name")  return direction === "asc" ? "name_asc"  : "name_desc";
  if (field === "group") return direction === "asc" ? "group_asc" : "group_desc";
  if (field === "empty") return direction === "asc" ? "empty_first" : "empty_last";
  return direction === "asc" ? "sum_asc" : "sum_desc";
}

const RESULT_COLUMNS: Array<{ key: ResultColumnKey; label: string; width: string }> = [
  // Порядок: Расчёт (книжный остаток) → Факт → Разница — естественная
  // последовательность для проверки инвентаризации.
  { key: "calculated", label: "Расчёт", width: "120px" },
  { key: "fact", label: "Факт", width: "120px" },
  { key: "difference", label: "Разница", width: "120px" },
  { key: "management", label: "Упр. сумма", width: "130px" },
  { key: "status", label: "Статус", width: "140px" },
  { key: "recount", label: "Пересчёт", width: "100px" },
  { key: "comment", label: "Комментарий", width: "minmax(180px,.7fr)" },
];

const DEFAULT_RESULT_COLUMNS = new Set<ResultColumnKey>(RESULT_COLUMNS.map((column) => column.key));

function hasDifference(item: InventoryDocumentResultItem) {
  const amount = Number(item.difference_amount ?? 0);
  const sum = Number(item.difference_sum ?? 0);
  return amount !== 0 || sum !== 0;
}

function differenceClass(value: number | null | undefined) {
  const numericValue = Number(value ?? 0);
  if (numericValue < 0) return "text-red-700";
  if (numericValue > 0) return "text-green-700";
  return "text-muted-foreground";
}

function formatQuantity(
  value: number | null | undefined,
  measureUnitName: string | null | undefined,
  amountRoundingScale: AmountRoundingScale,
) {
  const formatted = formatAmount(value, amountRoundingScale);
  if (formatted === "—") return formatted;
  return `${formatted} ${measureUnitName ?? "ед."}`;
}

export function InventoryResultsTable({
  documentId,
  items,
  resorts,
  resortItems,
  suggestions,
  amountRoundingScale,
  isFinalized,
  canComment,
  canAdjust,
  canFinalize,
  canRecount,
  aiSuggestionsEnabled,
  documentStatus,
}: Props) {
  const [showDifferences, setShowDifferences] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<ResultStatusFilter>("all");
  const [sorts, setSorts] = useState<ResultSortMode[]>([]);
  // pin-row скрыт по умолчанию, кнопка «Фильтры» нейтральна (как в актах).
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<ResultColumnKey>>(
    () => new Set(DEFAULT_RESULT_COLUMNS),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [comments, setComments] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.id, item.result_comment ?? ""])),
  );
  const [commentItem, setCommentItem] = useState<InventoryDocumentResultItem | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [deleteRuleItem, setDeleteRuleItem] = useState<InventoryDocumentResultItem | null>(null);
  const [deleteRuleReason, setDeleteRuleReason] = useState("");
  const [voidingResort, setVoidingResort] = useState<InventoryResultResortRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const activeResorts = useMemo(
    () => resorts.filter((resort) => resort.status === "active"),
    [resorts],
  );
  const activeResortIds = useMemo(
    () => new Set(activeResorts.map((resort) => resort.id)),
    [activeResorts],
  );
  const activeResortItemByItemId = useMemo(() => {
    const lookup = new Map<string, InventoryResultResortItemRow>();
    for (const item of resortItems) {
      if (activeResortIds.has(item.resortId)) lookup.set(item.documentItemId, item);
    }
    return lookup;
  }, [activeResortIds, resortItems]);
  const totals = useMemo(
    () =>
      calculateManagementTotals({
        items: items.map((item) => ({
          id: item.id,
          differenceAmount: item.difference_amount,
          differenceSum: item.difference_sum,
          excluded: item.excluded_from_totals,
        })),
        resortItems: Array.from(activeResortItemByItemId.values()).map((item) => ({
          id: item.documentItemId,
          sourceDifferenceAmount: item.sourceDifferenceAmount,
          sourceDifferenceSum: item.sourceDifferenceSum,
          offsetAmount: item.offsetAmount,
          remainingDifferenceAmount: item.remainingDifferenceAmount,
          remainingDifferenceSum: item.remainingDifferenceSum,
          role: item.role,
        })),
        // Корректировки себестоимости активных пересортов: плюсуются
        // к managementShortfallSum (см. docs/handbook/inventory/resort.md).
        resortCostAdjustments: activeResorts
          .map((resort) => Number(resort.cost_adjustment_sum ?? 0))
          .filter((value) => Number.isFinite(value) && value > 0),
      }),
    [activeResortItemByItemId, activeResorts, items],
  );
  const mismatchCount = useMemo(() => items.filter(hasDifference).length, [items]);
  const flaggedCount = useMemo(
    () => items.filter((item) => item.needs_recount).length,
    [items],
  );
  // «Отправить на пересчёт» доступно из ready_for_review / results_blocked.
  // Из recount_pending уже отправили; processed закрыт в QR.
  const canSendToRecount =
    canRecount && (documentStatus === "ready_for_review" || documentStatus === "results_blocked");
  const groupOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      if (item.group_id && item.group_name) map.set(item.group_id, item.group_name);
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }, [items]);
  const visibleColumnDefs = useMemo(
    () => RESULT_COLUMNS.filter((column) => visibleColumns.has(column.key)),
    [visibleColumns],
  );
  const tableGridTemplate = useMemo(
    () => ["40px", "minmax(260px,1.4fr)", ...visibleColumnDefs.map((column) => column.width), "48px"].join(" "),
    [visibleColumnDefs],
  );
  const visibleItems = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("ru");
    const searched = items.filter((item) => {
      if (showDifferences && !hasDifference(item)) return false;
      if (groupFilter !== "all" && item.group_id !== groupFilter) return false;

      const resortItem = activeResortItemByItemId.get(item.id);
      if (statusFilter === "included" && (item.excluded_from_totals || resortItem)) return false;
      if (statusFilter === "excluded" && !item.excluded_from_totals) return false;
      if (statusFilter === "resort" && !resortItem) return false;

      if (!query) return true;
      return [
        item.product_name,
        item.article,
        item.group_name,
        item.measure_unit_name,
        item.result_comment,
      ].some((value) => value?.toLocaleLowerCase("ru").includes(query));
    });

    return [...searched].sort((left, right) => {
      // Применяем сорты по приоритету. Tiebreaker — название (стабильный).
      for (const mode of sorts) {
        const field = resultSortToField(mode);
        const dir = resultSortToDirection(mode);
        let cmp = 0;
        if (field === "name") {
          cmp = left.product_name.localeCompare(right.product_name, "ru");
        } else if (field === "group") {
          cmp = (left.group_name ?? "").localeCompare(right.group_name ?? "", "ru");
        } else if (field === "empty") {
          const leftEmpty = left.actual_amount === null;
          const rightEmpty = right.actual_amount === null;
          if (leftEmpty !== rightEmpty) cmp = leftEmpty ? -1 : 1;
        } else {
          // sum: по модулю расхождения.
          cmp = Math.abs(Number(left.difference_sum ?? 0)) - Math.abs(Number(right.difference_sum ?? 0));
        }
        if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
      }
      return left.product_name.localeCompare(right.product_name, "ru");
    });
  }, [
    activeResortItemByItemId,
    groupFilter,
    items,
    searchQuery,
    showDifferences,
    sorts,
    statusFilter,
  ]);
  const hasActiveFilters =
    showDifferences || groupFilter !== "all" || statusFilter !== "all";
  const hasSortActive = sorts.length > 0;
  const hasSearch = searchQuery.trim().length > 0;
  const hasAnyActive = hasActiveFilters || hasSortActive || hasSearch;
  const showSearchPin = hasSearch && (filtersVisible || hasSortActive || hasActiveFilters);
  const currentGroupName =
    groupFilter === "all" ? null : groupOptions.find((g) => g.id === groupFilter)?.name ?? null;
  const onClearAll = () => {
    setShowDifferences(false);
    setSearchQuery("");
    setSearchOpen(false);
    setGroupFilter("all");
    setStatusFilter("all");
    setSorts([]);
  };
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  );

  const runAction = (
    action: () => Promise<{ error: string | null }>,
    success: string,
    onSuccess?: () => void,
  ) => {
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(success);
      setSelectedIds(new Set());
      onSuccess?.();
    });
  };

  const toggleSelected = (itemId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const toggleColumn = (column: ResultColumnKey, checked: boolean) => {
    setVisibleColumns((current) => {
      const next = new Set(current);
      if (checked) next.add(column);
      else next.delete(column);
      return next;
    });
  };

  const createResort = (itemIds: string[], reason?: string, source: "manual" | "history" | "ai" = "manual", confidence?: number) => {
    runAction(
      () =>
        createInventoryResultResort({
          documentId,
          itemIds,
          reason,
          suggestionSource: source,
          suggestionConfidence: confidence ?? null,
        }),
      "Пересорт создан",
    );
  };

  const dismissSuggestion = (suggestion: InventoryResortSuggestion) => {
    runAction(
      () =>
        dismissInventoryResortSuggestion({
          documentId,
          key: suggestion.key,
          itemIds: suggestion.itemIds,
          source: suggestion.source,
          confidence: suggestion.confidence,
          reason: suggestion.reason,
        }),
      "Подсказка скрыта",
    );
  };

  if (items.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Построчных данных по акту нет.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Недостача</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs text-muted-foreground">По QR</div>
              <div className="mt-1 text-2xl font-semibold text-red-700">
                {formatMoney(Math.abs(totals.qrShortfallSum), "RUB", amountRoundingScale)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">К списанию</div>
              <div className="mt-1 text-2xl font-semibold text-red-700">
                {formatMoney(Math.abs(totals.managementShortfallSum), "RUB", amountRoundingScale)}
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Излишек</div>
            {isFinalized ? (
              <Badge variant="outline" className="gap-1">
                <Lock className="h-3 w-3" />
                Итоги подведены
              </Badge>
            ) : null}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs text-muted-foreground">По QR</div>
              <div className="mt-1 text-2xl font-semibold text-green-700">
                {formatMoney(Math.abs(totals.qrSurplusSum), "RUB", amountRoundingScale)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">К учету</div>
              <div className="mt-1 text-2xl font-semibold text-green-700">
                {formatMoney(Math.abs(totals.managementSurplusSum), "RUB", amountRoundingScale)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Журнал событий («Журнал решений») переехал в layout-табу «Журнал»
          (../history) — здесь была дублирующая внутренняя вкладка.
          Тулбар — 1-в-1 с /documents/inventory: TableControls (иконки
          справа, без рамки) + pin-row. */}
      <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <TableControls
          search={{
            value: searchQuery,
            onChange: setSearchQuery,
            open: searchOpen,
            onOpenChange: setSearchOpen,
            placeholder: "Поиск по позиции, артикулу, группе",
          }}
          filters={{
            active: hasActiveFilters,
            label: filtersVisible ? "Скрыть фильтры" : "Показать фильтры",
            onClick: () => setFiltersVisible((v) => !v),
          }}
          sort={{
            active: hasSortActive,
            content: <ResultSortFieldPanel sorts={sorts} onChange={setSorts} />,
          }}
          columns={{
            active: visibleColumns.size !== RESULT_COLUMNS.length,
            content: (
              <div className="space-y-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Столбцы таблицы
                </p>
                {RESULT_COLUMNS.map((column) => (
                  <label key={column.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={visibleColumns.has(column.key)}
                      onChange={(event) => toggleColumn(column.key, event.target.checked)}
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                    {column.label}
                  </label>
                ))}
              </div>
            ),
          }}
          secondaryActions={<RefreshResultsButton documentId={documentId} />}
          summary={
            <>
              Показано {visibleItems.length} из {items.length}; расхождений {mismatchCount}; выбрано {selectedItems.length}.
            </>
          }
        />
      </div>

      {/* Pin-row — порядок 1-в-1 с documents-table: Сортировка → divider →
          Расхождения · Группа · Статус → divider → Поиск → «Очистить все». */}
      {(filtersVisible || hasSortActive || hasSearch) ? (
        <div className="flex flex-wrap items-center gap-2">
          {hasSortActive ? (
            <TableControlPin
              active
              icon={
                sorts.length === 1
                  ? resultSortToDirection(sorts[0]) === "asc"
                    ? <ArrowUp className="h-3.5 w-3.5" />
                    : <ArrowDown className="h-3.5 w-3.5" />
                  : <ArrowUpDown className="h-3.5 w-3.5" />
              }
              label={
                sorts.length === 1
                  ? RESULT_SORT_FIELD_LABEL[resultSortToField(sorts[0])]
                  : `${sorts.length} сортировки`
              }
              onClear={() => setSorts([])}
              clearLabel="Сбросить сортировку"
              contentClassName="w-auto p-3"
            >
              <ResultSortPinEditor sorts={sorts} onChange={setSorts} />
            </TableControlPin>
          ) : null}

          {hasSortActive && (filtersVisible || showSearchPin) ? <ResultPinDivider /> : null}

          {filtersVisible ? (
            <>
              <TableControlPin
                active={showDifferences}
                label={showDifferences ? "Только расхождения" : "Расхождения"}
                onClear={showDifferences ? () => setShowDifferences(false) : undefined}
                clearLabel="Показать все строки"
              >
                <div className="p-1">
                  <button
                    type="button"
                    onClick={() => setShowDifferences((v) => !v)}
                    className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span>Только расхождения</span>
                    {showDifferences ? <Check className="h-4 w-4 shrink-0" /> : null}
                  </button>
                </div>
              </TableControlPin>

              <TableControlPin
                active={groupFilter !== "all"}
                label={currentGroupName ? `Группа: ${currentGroupName}` : "Группа"}
                onClear={groupFilter !== "all" ? () => setGroupFilter("all") : undefined}
                clearLabel="Сбросить группу"
              >
                <ResultGroupPicker
                  value={groupFilter}
                  options={groupOptions}
                  onChange={setGroupFilter}
                />
              </TableControlPin>

              <TableControlPin
                active={statusFilter !== "all"}
                label={statusFilter !== "all" ? `Статус: ${RESULT_STATUS_LABEL[statusFilter]}` : "Статус"}
                onClear={statusFilter !== "all" ? () => setStatusFilter("all") : undefined}
                clearLabel="Сбросить статус"
              >
                <ResultStatusPicker value={statusFilter} onChange={setStatusFilter} />
              </TableControlPin>
            </>
          ) : null}

          {filtersVisible && showSearchPin ? <ResultPinDivider /> : null}

          {showSearchPin ? (
            <TableControlPin
              active
              icon={<SearchIcon className="h-3.5 w-3.5" />}
              label={`Поиск: ${searchQuery.trim()}`}
              onClear={() => { setSearchQuery(""); setSearchOpen(false); }}
              clearLabel="Очистить поиск"
            >
              <div className="space-y-2 p-2">
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Поиск"
                  className="h-8"
                />
                <p className="text-xs text-muted-foreground">
                  По названию, артикулу, группе, комментарию.
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

      {suggestions.length > 0 ? (
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <WandSparkles className="h-4 w-4 text-blue-600" />
          <div className="text-sm font-medium">Предложения пересорта</div>
          {aiSuggestionsEnabled ? <Badge variant="outline">AI включен</Badge> : <Badge variant="secondary">История</Badge>}
        </div>
        <div className="grid gap-2">
            {suggestions.map((suggestion) => (
              <div key={suggestion.key} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-medium">{suggestion.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {suggestion.source === "ai" ? "AI" : "История"} · {suggestion.reason} · уверенность {Math.round(suggestion.confidence * 100)}%
                  </div>
                </div>
                {canAdjust ? (
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" disabled={isFinalized || isPending} onClick={() => dismissSuggestion(suggestion)}>
                      Скрыть
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isFinalized || isPending}
                      onClick={() => createResort(suggestion.itemIds, suggestion.reason, suggestion.source, suggestion.confidence)}
                    >
                      Применить
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
        </div>
      </div>
      ) : null}

      {visibleItems.length === 0 ? (
        <div className="rounded-lg border bg-card p-4 text-sm">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 className="h-4 w-4" />
            Расхождений по строкам нет.
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div
            className="grid items-center border-b bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground"
            style={{ gridTemplateColumns: tableGridTemplate }}
          >
            <div />
            <div>Позиция</div>
            {visibleColumnDefs.map((column) => (
              <div key={column.key}>{column.label}</div>
            ))}
            <div />
          </div>
          {visibleItems.map((item) => {
            const resortItem = activeResortItemByItemId.get(item.id);
            const managementSum = item.excluded_from_totals
              ? 0
              : resortItem
                ? resortItem.remainingDifferenceSum
                : item.difference_sum;
            const isExcluded = item.excluded_from_totals === true;
            const isSelectable = !isFinalized && !isExcluded && !resortItem;
            return (
              <div
                key={item.id}
                className="grid items-center gap-2 border-b px-3 py-3 text-sm last:border-b-0"
                style={{ gridTemplateColumns: tableGridTemplate }}
              >
                <div>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    disabled={!isSelectable}
                    onChange={() => toggleSelected(item.id)}
                    className="h-4 w-4 rounded border-input"
                    aria-label={`Выбрать ${item.product_name}`}
                  />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium">{item.product_name}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {item.article ?? "Без артикула"} · {item.measure_unit_name ?? "ед."}
                    {item.group_name ? ` · ${item.group_name}` : ""}
                  </div>
                </div>
                {visibleColumnDefs.map((column) => {
                  if (column.key === "calculated") {
                    return (
                      <div key={column.key} className="text-muted-foreground">
                        {formatQuantity(item.calculated_amount, item.measure_unit_name, amountRoundingScale)}
                      </div>
                    );
                  }
                  if (column.key === "fact") {
                    return (
                      <div key={column.key}>
                        {formatQuantity(item.actual_amount, item.measure_unit_name, amountRoundingScale)}
                      </div>
                    );
                  }
                  if (column.key === "difference") {
                    return (
                      <div key={column.key} className={differenceClass(item.difference_amount)}>
                        {formatQuantity(item.difference_amount, item.measure_unit_name, amountRoundingScale)}
                      </div>
                    );
                  }
                  if (column.key === "management") {
                    return (
                      <div key={column.key} className={differenceClass(managementSum)}>
                        {formatSignedMoney(managementSum, "RUB", amountRoundingScale)}
                      </div>
                    );
                  }
                  if (column.key === "status") {
                    return (
                      <div key={column.key} className="flex items-center gap-2">
                        {resortItem ? (
                          <Repeat2 className="h-4 w-4 text-blue-600" />
                        ) : isExcluded ? (
                          <XCircle className="h-4 w-4 text-red-600" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-green-700" />
                        )}
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium">
                            {isExcluded ? "Не учитывать" : resortItem ? "Пересорт" : "Учитывать"}
                          </div>
                          {item.exclusion_rule_id ? (
                            <div className="text-[11px] text-muted-foreground">Авто</div>
                          ) : null}
                        </div>
                      </div>
                    );
                  }
                  if (column.key === "recount") {
                    const flagged = Boolean(item.needs_recount);
                    const auto = Boolean(item.recount_auto_flagged);
                    return (
                      <div key={column.key} className="flex items-center gap-2">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={flagged}
                          disabled={!canRecount || isFinalized || isPending}
                          onClick={() =>
                            runAction(
                              () =>
                                setRecountFlag({
                                  documentId,
                                  itemId: item.id,
                                  needsRecount: !flagged,
                                }),
                              flagged ? "Пометка пересчёта снята" : "Строка отмечена на пересчёт",
                            )
                          }
                          className={cn(
                            "inline-flex h-6 w-10 items-center rounded-full border transition-colors",
                            flagged
                              ? "border-rose-300 bg-rose-500/15 dark:border-rose-500/40 dark:bg-rose-500/20"
                              : "border-border bg-muted/40 hover:bg-muted",
                            !canRecount || isFinalized ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                          )}
                          title={
                            flagged
                              ? auto
                                ? "Автоматически отмечено по threshold заведения. Кликните, чтобы снять."
                                : "Ручная пометка. Кликните, чтобы снять."
                              : "Кликните, чтобы отметить строку на пересчёт."
                          }
                        >
                          <span
                            className={cn(
                              "h-4 w-4 rounded-full bg-background shadow transition-transform",
                              flagged ? "translate-x-5" : "translate-x-1",
                            )}
                          />
                        </button>
                        {flagged && auto ? (
                          <span className="text-[11px] text-muted-foreground">Авто</span>
                        ) : null}
                      </div>
                    );
                  }
                  return (
                    <div key={column.key} className="min-w-0 text-sm text-muted-foreground">
                      {item.result_comment ? (
                        <div className="flex min-w-0 items-center gap-1">
                          <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{item.result_comment}</span>
                        </div>
                      ) : item.exclude_reason ? (
                        <span className="truncate">Причина: {item.exclude_reason}</span>
                      ) : (
                        <span>—</span>
                      )}
                    </div>
                  );
                })}
                <div className="flex justify-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="icon" variant="ghost" disabled={isFinalized || isPending}>
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Действия</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      {canComment ? (
                        <DropdownMenuItem
                          onClick={() => {
                            setCommentItem(item);
                            setCommentDraft(comments[item.id] ?? item.result_comment ?? "");
                          }}
                        >
                          <MessageSquarePlus className="mr-2 h-4 w-4 text-blue-600" />
                          Комментировать
                        </DropdownMenuItem>
                      ) : null}
                      {canAdjust ? (
                        <>
                          {isExcluded ? (
                            <DropdownMenuItem
                              onClick={() =>
                                runAction(
                                  () => setInventoryResultItemExcluded({ documentId, itemId: item.id, excluded: false }),
                                  "Строка возвращена в итоги",
                                )
                              }
                            >
                              <CheckCircle2 className="mr-2 h-4 w-4 text-green-700" />
                              Учитывать в этом акте
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              disabled={Boolean(resortItem)}
                              onClick={() =>
                                runAction(
                                  () => setInventoryResultItemExcluded({ documentId, itemId: item.id, excluded: true }),
                                  "Строка исключена из итогов",
                                )
                              }
                            >
                              <Ban className="mr-2 h-4 w-4 text-red-600" />
                              Не учитывать в этом акте
                            </DropdownMenuItem>
                          )}
                          {!item.exclusion_rule_id ? (
                            <DropdownMenuItem
                              disabled={Boolean(resortItem)}
                              onClick={() =>
                                runAction(
                                  () => createInventoryResultExclusionRule({ documentId, itemId: item.id }),
                                  "Позиция добавлена в автоисключения",
                                )
                              }
                            >
                              <Ban className="mr-2 h-4 w-4 text-orange-600" />
                              Исключать всегда
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => {
                                setDeleteRuleItem(item);
                                setDeleteRuleReason("");
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4 text-red-600" />
                              Удалить автоисключение
                            </DropdownMenuItem>
                          )}
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeResorts.length > 0 ? (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 text-sm font-medium">Активные пересорты</div>
          <div className="grid gap-2">
            {activeResorts.map((resort) => (
              <div key={resort.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-medium">{resort.group_name ?? "Группа"} · {formatAmount(resort.offset_amount, amountRoundingScale)} ед.</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Остаток: недостача {formatMoney(Math.abs(resort.residual_shortfall_sum ?? 0), "RUB", amountRoundingScale)}, излишек {formatMoney(Math.abs(resort.residual_surplus_sum ?? 0), "RUB", amountRoundingScale)}
                  </div>
                  {Number(resort.cost_adjustment_sum ?? 0) > 0 ? (
                    // Корректировка себестоимости (миграция 205): когда
                    // пересорт покрыл дорогое товаром по более низкой
                    // себестоимости — разница идёт в управленческую
                    // недостачу. См. docs/handbook/inventory/resort.md.
                    <div className="mt-1 text-xs text-rose-700">
                      Корректировка себестоимости: −{formatMoney(Number(resort.cost_adjustment_sum), "RUB", amountRoundingScale)}
                    </div>
                  ) : null}
                </div>
                {canAdjust ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isFinalized || isPending}
                    onClick={() => {
                      setVoidingResort(resort);
                      setVoidReason("");
                    }}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Отменить
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Низ страницы — без рамки: summary слева, document-level действия
          справа («Отправить на пересчёт» + «Подвести итоги»/«Редактировать
          итоги»). Поясняющий текст про блокировку — в тултипе кнопки. */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="text-xs text-muted-foreground">
          Показано {visibleItems.length} из {items.length}; расхождений {mismatchCount}; выбрано {selectedItems.length}.
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSendToRecount ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isFinalized || isPending || flaggedCount === 0}
                      onClick={() =>
                        runAction(
                          () => returnDocumentForRecount({ documentId }),
                          `Акт отправлен на пересчёт (${flaggedCount} ${flaggedCount === 1 ? "строка" : "строк"})`,
                        )
                      }
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Отправить на пересчёт{flaggedCount > 0 ? ` (${flaggedCount})` : ""}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {flaggedCount === 0
                    ? "Отметьте флажком «Пересчёт» хотя бы одну строку."
                    : `На пересчёт уйдут ${flaggedCount} отмеченных строк.`}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}

          {canFinalize ? (
            isFinalized ? (
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() =>
                  runAction(
                    () => reopenInventoryResults({ documentId, reason: "Режим редактирования итогов" }),
                    "Итоги открыты для редактирования",
                  )
                }
              >
                <Undo2 className="mr-2 h-4 w-4" />
                Редактировать итоги
              </Button>
            ) : (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          runAction(() => finalizeInventoryResults({ documentId }), "Итоги подведены")
                        }
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Подвести итоги
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[280px]">
                    После подведения итогов пересорты, комментарии и исключения будут
                    заблокированы до переоткрытия.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )
          ) : null}
        </div>
      </div>
      </div>

      <Dialog open={Boolean(commentItem)} onOpenChange={(open) => !open && setCommentItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Комментарий к позиции</DialogTitle>
            <DialogDescription>{commentItem?.product_name}</DialogDescription>
          </DialogHeader>
          <Textarea value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="Комментарий" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCommentItem(null)}>
              Отмена
            </Button>
            <Button
              type="button"
              disabled={!commentItem || isPending}
              onClick={() => {
                if (!commentItem) return;
                const itemId = commentItem.id;
                runAction(
                  () => updateInventoryResultComment({ documentId, itemId, comment: commentDraft }),
                  "Комментарий сохранен",
                  () => {
                    setComments((current) => ({ ...current, [itemId]: commentDraft }));
                    setCommentItem(null);
                  },
                );
              }}
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteRuleItem)} onOpenChange={(open) => !open && setDeleteRuleItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить автоисключение</DialogTitle>
            <DialogDescription>{deleteRuleItem?.product_name}</DialogDescription>
          </DialogHeader>
          <Textarea value={deleteRuleReason} onChange={(event) => setDeleteRuleReason(event.target.value)} placeholder="Причина удаления" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteRuleItem(null)}>
              Отмена
            </Button>
            <Button
              type="button"
              disabled={!deleteRuleItem || isPending || !deleteRuleReason.trim()}
              onClick={() => {
                if (!deleteRuleItem) return;
                runAction(
                  () => deleteInventoryResultExclusionRule({ documentId, itemId: deleteRuleItem.id, reason: deleteRuleReason }),
                  "Автоисключение удалено",
                  () => setDeleteRuleItem(null),
                );
              }}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(voidingResort)} onOpenChange={(open) => !open && setVoidingResort(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отменить пересорт</DialogTitle>
            <DialogDescription>Укажите причину отмены. Действие попадет в журнал решений.</DialogDescription>
          </DialogHeader>
          <Textarea value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Причина отмены" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setVoidingResort(null)}>
              Отмена
            </Button>
            <Button
              type="button"
              disabled={!voidingResort || isPending || !voidReason.trim()}
              onClick={() => {
                if (!voidingResort) return;
                runAction(
                  () => voidInventoryResultResort({ documentId, resortId: voidingResort.id, reason: voidReason }),
                  "Пересорт отменен",
                  () => setVoidingResort(null),
                );
              }}
            >
              Отменить пересорт
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Floating bar групповых действий — появляется при выборе строк.
          Сюда «опущены» все row-bulk операции: Пересорт / Не учитывать /
          Исключать всегда / Пересчёт. */}
      {canAdjust || canRecount ? (
        <TableBulkBar
          floating
          selectedCount={selectedItems.length}
          onClear={() => setSelectedIds(new Set())}
          actions={
            <>
              {canAdjust ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={isFinalized || isPending || selectedItems.length < 2}
                    onClick={() => createResort(Array.from(selectedIds))}
                  >
                    Пересорт
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    disabled={isFinalized || isPending || selectedItems.length === 0}
                    onClick={() =>
                      runAction(
                        async () => {
                          for (const itemId of selectedIds) {
                            const result = await setInventoryResultItemExcluded({
                              documentId,
                              itemId,
                              excluded: true,
                            });
                            if (result.error) return result;
                          }
                          return { error: null };
                        },
                        "Строки исключены из итогов",
                      )
                    }
                  >
                    Не учитывать
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    disabled={isFinalized || isPending || selectedItems.length === 0}
                    onClick={() =>
                      runAction(
                        async () => {
                          for (const itemId of selectedIds) {
                            const result = await createInventoryResultExclusionRule({ documentId, itemId });
                            if (result.error) return result;
                          }
                          return { error: null };
                        },
                        "Позиции добавлены в автоисключения",
                      )
                    }
                  >
                    Исключать всегда
                  </Button>
                </>
              ) : null}
              {canRecount ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={isFinalized || isPending || selectedItems.length === 0}
                  onClick={() =>
                    runAction(
                      async () => {
                        for (const itemId of selectedIds) {
                          const result = await setRecountFlag({ documentId, itemId, needsRecount: true });
                          if (result.error) return result;
                        }
                        return { error: null };
                      },
                      "Строки отмечены на пересчёт",
                    )
                  }
                >
                  Пересчёт
                </Button>
              ) : null}
            </>
          }
        />
      ) : null}
    </div>
  );
}

// ─── Toolbar sub-components (1-в-1 паттерн documents-table) ──────────────────

function ResultPinDivider() {
  return <div className="mx-1 h-6 w-px bg-border" aria-hidden="true" />;
}

/**
 * Popover из sort-кнопки в шапке. Список полей; клик на свободном — APPEND
 * с asc, уже добавленные показывают «Добавлено».
 */
function ResultSortFieldPanel({
  sorts,
  onChange,
}: {
  sorts: ResultSortMode[];
  onChange: (next: ResultSortMode[]) => void;
}) {
  const usedFields = new Set(sorts.map((mode) => resultSortToField(mode)));
  return (
    <div className="space-y-3">
      <p className="px-3 pt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        Сортировка
      </p>
      <div className="space-y-1">
        {RESULT_SORT_FIELDS.map((field) => {
          const used = usedFields.has(field);
          return (
            <button
              key={field}
              type="button"
              onClick={() => {
                if (used) return;
                onChange([...sorts, combineResultSort(field, "asc")]);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-accent",
                used ? "bg-accent text-muted-foreground" : null,
              )}
            >
              <span>{RESULT_SORT_FIELD_LABEL[field]}</span>
              {used ? <span className="text-xs">Добавлено</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Контент активного sort-pin: строки field-Select + direction-Select + ×. */
function ResultSortPinEditor({
  sorts,
  onChange,
}: {
  sorts: ResultSortMode[];
  onChange: (next: ResultSortMode[]) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const unusedFields = RESULT_SORT_FIELDS.filter(
    (field) => !sorts.some((mode) => resultSortToField(mode) === field),
  );

  const updateAt = (index: number, next: ResultSortMode) => {
    onChange(sorts.map((mode, i) => (i === index ? next : mode)));
  };
  const replaceField = (index: number, field: ResultSortField) => {
    updateAt(index, combineResultSort(field, resultSortToDirection(sorts[index])));
  };
  const removeAt = (index: number) => onChange(sorts.filter((_, i) => i !== index));

  return (
    <div className="w-[min(420px,calc(100vw-3rem))] space-y-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Сортировка</p>
      <div className="space-y-2">
        {sorts.map((mode, index) => {
          const field = resultSortToField(mode);
          const direction = resultSortToDirection(mode);
          return (
            <div key={`${field}-${index}`} className="grid grid-cols-[1fr_72px_32px] items-center gap-2">
              <Select value={field} onValueChange={(value) => replaceField(index, value as ResultSortField)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESULT_SORT_FIELDS.map((option) => {
                    const disabled = sorts.some(
                      (other, otherIndex) => otherIndex !== index && resultSortToField(other) === option,
                    );
                    return (
                      <SelectItem key={option} value={option} disabled={disabled}>
                        {RESULT_SORT_FIELD_LABEL[option]}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <Select
                value={direction}
                onValueChange={(value) => updateAt(index, combineResultSort(field, value as "asc" | "desc"))}
              >
                <SelectTrigger
                  className="h-9 w-[72px] justify-center gap-1 px-2"
                  aria-label={direction === "asc" ? "По возрастанию" : "По убыванию"}
                >
                  {direction === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
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
        <div className="rounded-lg border bg-card p-2">
          {unusedFields.map((field) => (
            <button
              key={field}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                onChange([...sorts, combineResultSort(field, "asc")]);
                setShowAdd(false);
              }}
            >
              <ArrowUp className="h-4 w-4 text-muted-foreground" />
              {RESULT_SORT_FIELD_LABEL[field]}
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

function ResultGroupPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ id: string; name: string }>;
  onChange: (groupId: string) => void;
}) {
  return (
    <div className="max-h-64 space-y-0.5 overflow-y-auto p-1">
      <button
        type="button"
        onClick={() => onChange("all")}
        className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
      >
        <span className="truncate">Все группы</span>
        {value === "all" ? <Check className="h-4 w-4 shrink-0" /> : null}
      </button>
      {options.map((group) => (
        <button
          key={group.id}
          type="button"
          onClick={() => onChange(group.id)}
          className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
        >
          <span className="truncate">{group.name}</span>
          {value === group.id ? <Check className="h-4 w-4 shrink-0" /> : null}
        </button>
      ))}
    </div>
  );
}

function ResultStatusPicker({
  value,
  onChange,
}: {
  value: ResultStatusFilter;
  onChange: (next: ResultStatusFilter) => void;
}) {
  const options: ResultStatusFilter[] = ["all", "included", "excluded", "resort"];
  return (
    <div className="space-y-0.5 p-1">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
        >
          <span className="truncate">{RESULT_STATUS_LABEL[option]}</span>
          {value === option ? <Check className="h-4 w-4 shrink-0" /> : null}
        </button>
      ))}
    </div>
  );
}
