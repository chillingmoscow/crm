"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
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
  Ban,
  Check,
  CheckCircle2,
  Loader2,
  Lock,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
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
  bulkCreateInventoryResultExclusionRules,
  bulkSetInventoryResultItemsExcluded,
  bulkSetRecountFlag,
  createInventoryResultExclusionRule,
  createInventoryResultResort,
  deleteInventoryResultExclusionRule,
  dismissInventoryResortSuggestion,
  finalizeInventoryResults,
  getAiResortSuggestions,
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
import type { ResortSuggestion } from "@/lib/inventory/resort-suggestions";
import {
  COLUMN_TO_RESULT_FIELD,
  RESULT_COLUMNS,
  RESULT_RECOUNT_LABEL,
  RESULT_SORT_FIELD_LABEL,
  RESULT_STATUS_LABEL,
  RESULTS_TABLE_ID,
  combineResultSort,
  differenceClass,
  hasDifference,
  isOpenDifference,
  resultSortToDirection,
  resultSortToField,
  type ResultColumnKey,
  type ResultRecountFilter,
  type ResultSortField,
  type ResultSortMode,
  type ResultStatusFilter,
} from "./results-table-utils";
import {
  ResultGroupPicker,
  ResultPinDivider,
  ResultRecountPicker,
  ResultSortFieldPanel,
  ResultSortPinEditor,
  ResultStatusPicker,
} from "./results-table-controls";
import {
  formatAmount,
  formatMoney,
  formatSignedMoney,
  type AmountRoundingScale,
} from "@/lib/format/amount";
import { pluralRu } from "@/lib/format/plural";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TableBulkBar,
  TableColumnManager,
  TableControls,
  TableControlPin,
  useTableState,
  type ManagedTableColumn,
  type TableStateColumn,
} from "@/components/shared/table";
import { cn } from "@/lib/utils";
import { IngredientOverviewSheet } from "./ingredient-overview-sheet";
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

// Единый источник типа подсказки — @/lib/inventory/resort-suggestions.
export type InventoryResortSuggestion = ResortSuggestion;

type Props = {
  documentId: string;
  items: InventoryDocumentResultItem[];
  resorts: InventoryResultResortRow[];
  resortItems: InventoryResultResortItemRow[];
  suggestions: InventoryResortSuggestion[];
  amountRoundingScale: AmountRoundingScale;
  isFinalized: boolean;
  /** Read-only: финализирован ИЛИ проведён в QR и не разблокирован. */
  isLocked: boolean;
  canComment: boolean;
  canAdjust: boolean;
  canFinalize: boolean;
  canRecount: boolean;
  /** inventory.view_products — нужно, чтобы открыть карточку ингредиента
      из «Итогов» (та же граница, что у каталога). */
  canViewProducts: boolean;
  aiSuggestionsEnabled: boolean;
  documentStatus: string;
};

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
  isLocked,
  canComment,
  canAdjust,
  canFinalize,
  canRecount,
  canViewProducts,
  aiSuggestionsEnabled,
  documentStatus,
}: Props) {
  const [showDifferences, setShowDifferences] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<ResultStatusFilter>("all");
  const [recountFilter, setRecountFilter] = useState<ResultRecountFilter>("all");
  const [sorts, setSorts] = useState<ResultSortMode[]>([]);
  // pin-row скрыт по умолчанию, кнопка «Фильтры» нейтральна (как в актах).
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [commentItem, setCommentItem] = useState<InventoryDocumentResultItem | null>(null);
  // Боковая панель «Обзор ингредиента» — открывается кликом по названию позиции.
  const [overviewIngredient, setOverviewIngredient] = useState<{ id: string; name: string } | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [deleteRuleItem, setDeleteRuleItem] = useState<InventoryDocumentResultItem | null>(null);
  const [deleteRuleReason, setDeleteRuleReason] = useState("");
  const [voidingResort, setVoidingResort] = useState<InventoryResultResortRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [isPending, startTransition] = useTransition();
  // ИИ-подсказки грузятся по кнопке (не блокируют открытие акта).
  const [aiSuggestions, setAiSuggestions] = useState<InventoryResortSuggestion[]>([]);
  const [aiRequested, setAiRequested] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

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
  const mismatchCount = useMemo(
    () => items.filter((item) => isOpenDifference(item, activeResortItemByItemId.get(item.id))).length,
    [items, activeResortItemByItemId],
  );
  const flaggedCount = useMemo(
    () => items.filter((item) => item.needs_recount).length,
    [items],
  );
  // «Отправить на пересчёт» доступно из ready_for_review / results_blocked.
  // Из recount_pending уже отправили; processed закрыт в QR.
  const canSendToRecount =
    canRecount && (documentStatus === "ready_for_review" || documentStatus === "results_blocked");
  // Акт на пересчёте у исполнителя: ревьюер ждёт, итоги заморожены
  // (анти-подгонка). Все инструменты редактирования итогов гейтятся на
  // adjustLocked = настоящий замок ИЛИ recount_pending. Кнопки
  // финализации/разблокировки в футере используют именно isLocked.
  const isRecountPending = documentStatus === "recount_pending";
  const adjustLocked = isLocked || isRecountPending;
  const groupOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      if (item.group_id && item.group_name) map.set(item.group_id, item.group_name);
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }, [items]);
  const visibleItems = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("ru");
    const searched = items.filter((item) => {
      if (showDifferences && !hasDifference(item)) return false;
      if (groupFilter !== "all" && item.group_id !== groupFilter) return false;

      const resortItem = activeResortItemByItemId.get(item.id);
      if (statusFilter === "included" && (item.excluded_from_totals || resortItem)) return false;
      if (statusFilter === "excluded" && !item.excluded_from_totals) return false;
      if (statusFilter === "resort" && !resortItem) return false;

      if (recountFilter === "flagged" && !item.needs_recount) return false;
      if (recountFilter === "clear" && item.needs_recount) return false;

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
    recountFilter,
    searchQuery,
    showDifferences,
    sorts,
    statusFilter,
  ]);
  const hasActiveFilters =
    showDifferences || groupFilter !== "all" || statusFilter !== "all" || recountFilter !== "all";
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
    setRecountFilter("all");
    setSorts([]);
  };
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  );

  const runAction = useCallback(
    (
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
    },
    [startTransition],
  );

  // Массовое действие: один серверный вызов, честный тост «N применено /
  // M пропущено» (вместо клиентского цикла, падавшего на первой ошибке).
  const runBulkAction = useCallback(
    (
      action: () => Promise<{ updated: number; skipped?: number; error: string | null }>,
      doneLabel: string,
    ) => {
      startTransition(async () => {
        const result = await action();
        if (result.error) {
          toast.error(result.error);
          return;
        }
        const skipped = result.skipped ?? 0;
        if (result.updated === 0) {
          toast.message(skipped > 0 ? `Нет подходящих строк (пропущено: ${skipped})` : "Нечего применять");
        } else {
          toast.success(skipped > 0 ? `${doneLabel}: ${result.updated} · пропущено: ${skipped}` : `${doneLabel}: ${result.updated}`);
        }
        setSelectedIds(new Set());
      });
    },
    [startTransition],
  );

  const toggleSelected = (itemId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const cycleSort = (field: ResultSortField) => {
    const index = sorts.findIndex((mode) => resultSortToField(mode) === field);
    if (index < 0) {
      setSorts([...sorts, combineResultSort(field, "asc")]);
      return;
    }
    if (resultSortToDirection(sorts[index]) === "asc") {
      const next = sorts.slice();
      next[index] = combineResultSort(field, "desc");
      setSorts(next);
      return;
    }
    setSorts(sorts.filter((_, i) => i !== index));
  };

  const headerIndicator = (columnId: string) => {
    const field = COLUMN_TO_RESULT_FIELD[columnId];
    if (!field) return null;
    const idx = sorts.findIndex((mode) => resultSortToField(mode) === field);
    if (idx < 0) return null;
    const dir = resultSortToDirection(sorts[idx]);
    return (
      <span className="inline-flex items-center gap-0.5">
        {dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
        {sorts.length > 1 ? <span className="text-[10px] tabular-nums">{idx + 1}</span> : null}
      </span>
    );
  };

  // aria-sort для сортируемых заголовков (ascending/descending/none).
  const headerAriaSort = (columnId: string): "ascending" | "descending" | "none" | undefined => {
    const field = COLUMN_TO_RESULT_FIELD[columnId];
    if (!field) return undefined;
    const idx = sorts.findIndex((mode) => resultSortToField(mode) === field);
    if (idx < 0) return "none";
    return resultSortToDirection(sorts[idx]) === "asc" ? "ascending" : "descending";
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
      () => setAiSuggestions((prev) => prev.filter((s) => s.key !== suggestion.key)),
    );
  };

  // История (props) + ИИ (по кнопке), дедуп по ключу.
  const displayedSuggestions = useMemo(() => {
    const byKey = new Map<string, InventoryResortSuggestion>();
    for (const s of suggestions) byKey.set(s.key, s);
    for (const s of aiSuggestions) if (!byKey.has(s.key)) byKey.set(s.key, s);
    return Array.from(byKey.values())
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 8);
  }, [suggestions, aiSuggestions]);

  const canRequestAi = aiSuggestionsEnabled && canAdjust && !adjustLocked && !aiRequested;

  const requestAiSuggestions = async () => {
    setAiLoading(true);
    try {
      const result = await getAiResortSuggestions({ documentId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setAiSuggestions(result.suggestions);
      setAiRequested(true);
      if (result.suggestions.length === 0) toast.message("ИИ не нашёл подходящих пересортов");
    } finally {
      setAiLoading(false);
    }
  };

  // ── TanStack column-state (resize / visibility / order) 1-в-1 с
  //    documents-table. Сорт — наш (через `sorts`), не TanStack. ──────────
  const renderResultCell = useCallback(
    (key: ResultColumnKey, item: InventoryDocumentResultItem) => {
      const resortItem = activeResortItemByItemId.get(item.id);
      const managementSum = item.excluded_from_totals
        ? 0
        : resortItem
          ? resortItem.remainingDifferenceSum
          : item.difference_sum;
      const isExcluded = item.excluded_from_totals === true;

      if (key === "calculated") {
        return (
          <span className="text-muted-foreground">
            {formatQuantity(item.calculated_amount, item.measure_unit_name, amountRoundingScale)}
          </span>
        );
      }
      if (key === "fact") {
        return <span>{formatQuantity(item.actual_amount, item.measure_unit_name, amountRoundingScale)}</span>;
      }
      if (key === "difference") {
        return (
          <span className={differenceClass(item.difference_amount)}>
            {formatQuantity(item.difference_amount, item.measure_unit_name, amountRoundingScale)}
          </span>
        );
      }
      if (key === "management") {
        return (
          <span className={differenceClass(managementSum)}>
            {formatSignedMoney(managementSum, "RUB", amountRoundingScale)}
          </span>
        );
      }
      if (key === "status") {
        return (
          <div className="flex items-center gap-2">
            {resortItem ? (
              <Repeat2 className="h-4 w-4 text-blue-600" />
            ) : isExcluded ? (
              <XCircle className="h-4 w-4 text-red-600" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-green-700 dark:text-green-400" />
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
      if (key === "recount") {
        const flagged = Boolean(item.needs_recount);
        const auto = Boolean(item.recount_auto_flagged);
        return (
          <div className="flex items-center gap-2" data-row-interactive>
            <button
              type="button"
              role="switch"
              aria-checked={flagged}
              disabled={!canRecount || adjustLocked || isPending}
              onClick={() =>
                runAction(
                  () => setRecountFlag({ documentId, itemId: item.id, needsRecount: !flagged }),
                  flagged ? "Пометка пересчёта снята" : "Строка отмечена на пересчёт",
                )
              }
              className={cn(
                "inline-flex h-6 w-10 items-center rounded-full border transition-colors",
                flagged
                  ? "border-rose-300 bg-rose-500/15 dark:border-rose-500/40 dark:bg-rose-500/20"
                  : "border-border bg-muted/40 hover:bg-muted",
                !canRecount || adjustLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer",
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
            {flagged && auto ? <span className="text-[11px] text-muted-foreground">Авто</span> : null}
          </div>
        );
      }
      // comment
      return (
        <div className="min-w-0 text-sm text-muted-foreground">
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
    },
    [activeResortItemByItemId, amountRoundingScale, canRecount, adjustLocked, isPending, documentId, runAction],
  );

  const renderSelectCell = useCallback(
    (item: InventoryDocumentResultItem) => {
      const resortItem = activeResortItemByItemId.get(item.id);
      const isExcluded = item.excluded_from_totals === true;
      const isSelectable = !adjustLocked && !isExcluded && !resortItem;
      return (
        <span data-row-interactive>
          <Checkbox
            checked={selectedIds.has(item.id)}
            disabled={!isSelectable}
            onCheckedChange={() => toggleSelected(item.id)}
            aria-label={`Выбрать ${item.product_name}`}
          />
        </span>
      );
    },
    [activeResortItemByItemId, adjustLocked, selectedIds],
  );

  const renderActionsCell = useCallback(
    (item: InventoryDocumentResultItem) => {
      const resortItem = activeResortItemByItemId.get(item.id);
      const isExcluded = item.excluded_from_totals === true;
      return (
        <div className="flex justify-end" data-row-interactive>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon" variant="ghost" disabled={adjustLocked || isPending}>
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Действия</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {canComment ? (
                <DropdownMenuItem
                  onClick={() => {
                    setCommentItem(item);
                    setCommentDraft(item.result_comment ?? "");
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
                      <CheckCircle2 className="mr-2 h-4 w-4 text-green-700 dark:text-green-400" />
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
      );
    },
    [activeResortItemByItemId, canAdjust, canComment, documentId, adjustLocked, isPending, runAction],
  );

  const columnsConfig = useMemo(
    () => [
      { id: "select", label: "", size: 44, canHide: false, cell: renderSelectCell },
      {
        id: "name",
        label: "Позиция",
        size: 280,
        canHide: false,
        cell: (item: InventoryDocumentResultItem) => (
          <div className="min-w-0">
            {canViewProducts && item.ingredient_id ? (
              <button
                type="button"
                data-row-interactive
                onClick={(e) => {
                  e.stopPropagation();
                  setOverviewIngredient({ id: item.ingredient_id as string, name: item.product_name });
                }}
                className="block max-w-full truncate text-left font-medium hover:text-brand hover:underline"
                title="Открыть карточку ингредиента"
              >
                {item.product_name}
              </button>
            ) : (
              <div className="truncate font-medium">{item.product_name}</div>
            )}
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {item.article ?? "Без артикула"} · {item.measure_unit_name ?? "ед."}
              {item.group_name ? ` · ${item.group_name}` : ""}
            </div>
          </div>
        ),
      },
      ...RESULT_COLUMNS.map((column) => ({
        id: column.key,
        label: column.label,
        size: column.size,
        canHide: true,
        cell: (item: InventoryDocumentResultItem) => renderResultCell(column.key, item),
      })),
      { id: "actions", label: "", size: 56, canHide: false, cell: renderActionsCell },
    ],
    [canViewProducts, renderActionsCell, renderResultCell, renderSelectCell],
  );

  const stateColumns: TableStateColumn[] = useMemo(
    () => columnsConfig.map((c) => ({ id: c.id, defaultVisible: true, defaultSize: c.size })),
    [columnsConfig],
  );
  const tableState = useTableState({ tableId: RESULTS_TABLE_ID, columns: stateColumns });
  const tableColumns = useMemo<ColumnDef<InventoryDocumentResultItem>[]>(
    () =>
      columnsConfig.map((column) => ({
        id: column.id,
        header: column.label,
        size: column.size,
        // min ≈ ширина заголовка; служебные (select/actions) уже.
        minSize: column.id === "select" ? 44 : column.id === "actions" ? 56 : 90,
        enableHiding: column.canHide,
        cell: ({ row }) => column.cell(row.original),
      })),
    [columnsConfig],
  );
  const table = useReactTable({
    data: visibleItems,
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
  const managedColumns: ManagedTableColumn[] = tableState.columnOrder
    .filter((id) => id !== "select" && id !== "actions")
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
  const sortableHeaderIds = useMemo(() => new Set(Object.keys(COLUMN_TO_RESULT_FIELD)), []);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Построчных данных по акту нет.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Баннер «акт на пересчёте»: ревьюер вернул акт исполнителю и ждёт.
          Итоги read-only (анти-подгонка) — нельзя пересортировать, исключать
          или финализировать, пока пересчёт не завершён. */}
      {isRecountPending ? (
        <div className="flex items-start gap-3 rounded-lg border border-rose-300 bg-rose-500/5 px-4 py-3 dark:border-rose-500/40 dark:bg-rose-500/10">
          <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-rose-700 dark:text-rose-300" />
          <div className="min-w-0 text-sm">
            <div className="font-medium text-rose-700 dark:text-rose-200">
              Акт на пересчёте у исполнителя
            </div>
            <p className="mt-0.5 text-rose-700/90 dark:text-rose-300/90">
              Итоги заморожены, пока исполнитель не завершит пересчёт. Когда
              он завершит, акт вернётся в «Готов к проверке» и итоги снова
              можно будет корректировать.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Недостача</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs text-muted-foreground">По QR</div>
              <div className="mt-1 text-2xl font-semibold text-red-700 dark:text-red-400">
                {formatMoney(Math.abs(totals.qrShortfallSum), "RUB", amountRoundingScale)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">К списанию</div>
              <div className="mt-1 text-2xl font-semibold text-red-700 dark:text-red-400">
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
              <div className="mt-1 text-2xl font-semibold text-green-700 dark:text-green-400">
                {formatMoney(Math.abs(totals.qrSurplusSum), "RUB", amountRoundingScale)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">К учету</div>
              <div className="mt-1 text-2xl font-semibold text-green-700 dark:text-green-400">
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
          secondaryActions={<RefreshResultsButton documentId={documentId} />}
          summary={
            <>
              Показано {visibleItems.length} из {items.length}; расхождений {mismatchCount}.
            </>
          }
        />
      </div>

      {/* Pin-row — порядок 1-в-1 с documents-table: Сортировка → divider →
          Расхождения · Группа · Статус → divider → Поиск → «Очистить все». */}
      {/* Pin-row НЕ показываем, если активен только поиск (без фильтров/
          сортировки) — иначе торчит одинокая «Очистить все». */}
      {(filtersVisible || hasSortActive || hasActiveFilters) ? (
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

              <TableControlPin
                active={recountFilter !== "all"}
                label={recountFilter !== "all" ? `Пересчёт: ${RESULT_RECOUNT_LABEL[recountFilter]}` : "Пересчёт"}
                onClear={recountFilter !== "all" ? () => setRecountFilter("all") : undefined}
                clearLabel="Сбросить фильтр пересчёта"
              >
                <ResultRecountPicker value={recountFilter} onChange={setRecountFilter} />
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

      {displayedSuggestions.length > 0 || canRequestAi || aiLoading ? (
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <WandSparkles className="h-4 w-4 text-blue-600" />
          <div className="text-sm font-medium">Предложения пересорта</div>
          {aiSuggestionsEnabled ? <Badge variant="outline">AI</Badge> : <Badge variant="secondary">История</Badge>}
          {canRequestAi || aiLoading ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto h-8 text-xs"
              disabled={aiLoading || isPending}
              onClick={requestAiSuggestions}
            >
              {aiLoading ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <WandSparkles className="mr-1 h-3.5 w-3.5" />
              )}
              Подсказки ИИ
            </Button>
          ) : null}
        </div>
        {displayedSuggestions.length > 0 ? (
        <div className="grid gap-2">
            {displayedSuggestions.map((suggestion) => (
              <div key={suggestion.key} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-medium">{suggestion.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {suggestion.source === "ai" ? "AI" : "История"} · {suggestion.reason} · уверенность {Math.round(suggestion.confidence * 100)}%
                  </div>
                </div>
                {canAdjust ? (
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" disabled={adjustLocked || isPending} onClick={() => dismissSuggestion(suggestion)}>
                      Скрыть
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={adjustLocked || isPending}
                      onClick={() => createResort(suggestion.itemIds, suggestion.reason, suggestion.source, suggestion.confidence)}
                    >
                      Применить
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
        </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {aiRequested
              ? "ИИ не нашёл подходящих пересортов."
              : "Нажмите «Подсказки ИИ», чтобы подобрать варианты пересорта."}
          </p>
        )}
      </div>
      ) : null}

      {visibleItems.length === 0 ? (
        <div className="rounded-lg border bg-card p-4 text-sm">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            Расхождений по строкам нет.
          </div>
        </div>
      ) : (
        // Без overflow на обёртках (иначе sticky-thead «ловится» контейнером).
        // Колонки вписаны в ширину (table-fixed + colgroup в %), без
        // горизонтального скролла; ресайз перетягивает ширину у соседей;
        // шапка липнет к верху страницы. См. design-system → sticky header.
        <div className="rounded-lg border bg-card">
            {/*
              suppressHydrationWarning: расширения браузера (TableConvert и пр.)
              дописывают на <table> атрибуты `data-tableconvert-*` между SSR и
              hydration → React ругается на mismatch. Атрибуты безвредны.
            */}
            <table suppressHydrationWarning className="w-full table-fixed">
              <colgroup>
                {table.getVisibleLeafColumns().map((column) => (
                  <col
                    key={column.id}
                    style={{ width: `${(column.getSize() / table.getTotalSize()) * 100}%` }}
                  />
                ))}
              </colgroup>
              <thead className="group/header sticky top-0 z-20 bg-muted [&_th]:bg-muted text-xs font-medium tracking-wide text-muted-foreground">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="h-11">
                    {headerGroup.headers.map((header) => {
                      const isControl = header.column.id === "select" || header.column.id === "actions";
                      const isSortable = sortableHeaderIds.has(header.column.id);
                      return (
                        <th
                          key={header.id}
                          aria-sort={headerAriaSort(header.column.id)}
                          className={cn("relative border-b px-3 py-3 text-left")}
                        >
                          {isControl ? null : isSortable ? (
                            <button
                              type="button"
                              className="flex max-w-full items-center gap-1 truncate hover:text-foreground"
                              onClick={() => cycleSort(COLUMN_TO_RESULT_FIELD[header.column.id])}
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
                          {header.column.getCanResize() && !isControl ? (
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
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="overflow-hidden px-3 py-3 align-middle text-sm"
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
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
                    disabled={adjustLocked || isPending}
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
          Показано {visibleItems.length} из {items.length}; расхождений {mismatchCount}.
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
                      disabled={adjustLocked || isPending || flaggedCount === 0}
                      onClick={() =>
                        runAction(
                          () => returnDocumentForRecount({ documentId }),
                          `Акт отправлен на пересчёт (${flaggedCount} ${pluralRu(flaggedCount, "строка", "строки", "строк")})`,
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
                    : `На пересчёт ${pluralRu(flaggedCount, "уйдёт", "уйдут", "уйдут")} ${flaggedCount} ${pluralRu(flaggedCount, "отмеченная строка", "отмеченные строки", "отмеченных строк")}.`}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}

          {canFinalize ? (
            isLocked ? (
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() =>
                  runAction(
                    () =>
                      reopenInventoryResults({
                        documentId,
                        reason: isFinalized
                          ? "Режим редактирования итогов"
                          : "Разблокировка проведённого акта",
                      }),
                    isFinalized
                      ? "Итоги открыты для редактирования"
                      : "Акт разблокирован для редактирования",
                  )
                }
              >
                <Undo2 className="mr-2 h-4 w-4" />
                {isFinalized ? "Редактировать итоги" : "Разблокировать акт"}
              </Button>
            ) : isRecountPending ? (
              // Акт на пересчёте — финализировать нельзя (см. баннер выше).
              <span className="text-xs text-muted-foreground">
                Финализация недоступна — акт на пересчёте.
              </span>
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

      <IngredientOverviewSheet
        ingredientId={overviewIngredient?.id ?? null}
        fallbackName={overviewIngredient?.name ?? ""}
        amountRoundingScale={amountRoundingScale}
        onClose={() => setOverviewIngredient(null)}
      />

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
                    disabled={adjustLocked || isPending || selectedItems.length < 2}
                    onClick={() => createResort(Array.from(selectedIds))}
                  >
                    Пересорт
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    disabled={adjustLocked || isPending || selectedItems.length === 0}
                    onClick={() =>
                      runBulkAction(
                        () =>
                          bulkSetInventoryResultItemsExcluded({
                            documentId,
                            itemIds: Array.from(selectedIds),
                            excluded: true,
                          }),
                        "Исключено из итогов",
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
                    disabled={adjustLocked || isPending || selectedItems.length === 0}
                    onClick={() =>
                      runBulkAction(
                        () =>
                          bulkCreateInventoryResultExclusionRules({
                            documentId,
                            itemIds: Array.from(selectedIds),
                          }),
                        "Добавлено в автоисключения",
                      )
                    }
                  >
                    Исключать всегда
                  </Button>
                </>
              ) : null}
              {canRecount ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    disabled={adjustLocked || isPending || selectedItems.length === 0}
                    onClick={() =>
                      runBulkAction(
                        () =>
                          bulkSetRecountFlag({
                            documentId,
                            itemIds: Array.from(selectedIds),
                            needsRecount: true,
                          }),
                        "Отмечено на пересчёт",
                      )
                    }
                  >
                    Пересчёт
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    disabled={adjustLocked || isPending || selectedItems.length === 0}
                    onClick={() =>
                      runBulkAction(
                        () =>
                          bulkSetRecountFlag({
                            documentId,
                            itemIds: Array.from(selectedIds),
                            needsRecount: false,
                          }),
                        "Снято пометок пересчёта",
                      )
                    }
                  >
                    Снять пересчёт
                  </Button>
                </>
              ) : null}
            </>
          }
        />
      ) : null}
    </div>
  );
}

