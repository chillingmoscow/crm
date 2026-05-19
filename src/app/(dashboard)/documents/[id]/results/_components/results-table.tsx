"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Ban,
  CheckCircle2,
  Lock,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Repeat2,
  RotateCcw,
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
  setInventoryResultItemExcluded,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { DataTableToolbar } from "@/components/shared/data-table-toolbar";

export type InventoryDocumentResultItem = {
  id: string;
  inventory_product_id: string | null;
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
};

export type InventoryResultResortRow = {
  id: string;
  status: string;
  reason: string;
  group_name: string | null;
  offset_amount: number | null;
  residual_shortfall_sum: number | null;
  residual_surplus_sum: number | null;
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
  events: InventoryResultEventRow[];
  suggestions: InventoryResortSuggestion[];
  amountRoundingScale: AmountRoundingScale;
  isFinalized: boolean;
  canComment: boolean;
  canAdjust: boolean;
  canFinalize: boolean;
  aiSuggestionsEnabled: boolean;
};

type ResultColumnKey = "fact" | "difference" | "management" | "status" | "comment";
type ResultStatusFilter = "all" | "included" | "excluded" | "resort";
type ResultSortMode = "name_asc" | "name_desc" | "group_asc" | "group_desc" | "empty_first" | "empty_last" | "sum_desc";

const RESULT_COLUMNS: Array<{ key: ResultColumnKey; label: string; width: string }> = [
  { key: "fact", label: "Факт", width: "120px" },
  { key: "difference", label: "Разница", width: "120px" },
  { key: "management", label: "Упр. сумма", width: "130px" },
  { key: "status", label: "Статус", width: "140px" },
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

function eventTypeLabel(eventType: string) {
  const labels: Record<string, string> = {
    comment_updated: "Комментарий",
    exclude_enabled: "Не учитывать",
    exclude_disabled: "Вернули в итог",
    persistent_exclusion_enabled: "Автоисключение",
    persistent_exclusion_disabled: "Удаление автоисключения",
    resort_created: "Пересорт",
    resort_voided: "Отмена пересорта",
    results_finalized: "Итоги подведены",
    results_reopened: "Редактирование",
    results_refreshed: "Обновление",
    suggestion_applied: "Подсказка принята",
    suggestion_dismissed: "Подсказка скрыта",
  };
  return labels[eventType] ?? eventType;
}

function payloadReason(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).reason;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function payloadResortText(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const items = (payload as Record<string, unknown>).items;
  if (!Array.isArray(items)) return null;

  const rows = items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const productName = typeof row.productName === "string" ? row.productName : null;
      const role = row.role === "surplus" || row.role === "shortage" ? row.role : null;
      const amount = typeof row.sourceDifferenceAmount === "number" ? row.sourceDifferenceAmount : null;
      if (!productName || !role || amount === null) return null;
      return { productName, role, amount };
    })
    .filter((item): item is { productName: string; role: "surplus" | "shortage"; amount: number } => Boolean(item));

  const surplus = rows
    .filter((row) => row.role === "surplus")
    .map((row) => `${row.productName} (+${formatAmount(row.amount, 2)})`);
  const shortfall = rows
    .filter((row) => row.role === "shortage")
    .map((row) => `${row.productName} (${formatAmount(row.amount, 2)})`);

  if (surplus.length === 0 || shortfall.length === 0) return null;
  return `${surplus.join(", ")} -> ${shortfall.join(", ")}`;
}

function payloadComment(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).comment;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function actorName(actor: InventoryResultEventRow["actor"], fallback: string | null) {
  const name = [actor?.first_name, actor?.last_name].filter(Boolean).join(" ").trim();
  return name || fallback || "Система";
}

function actorInitials(actor: InventoryResultEventRow["actor"], fallback: string | null) {
  const source = actorName(actor, fallback);
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "S";
}

export function InventoryResultsTable({
  documentId,
  items,
  resorts,
  resortItems,
  events,
  suggestions,
  amountRoundingScale,
  isFinalized,
  canComment,
  canAdjust,
  canFinalize,
  aiSuggestionsEnabled,
}: Props) {
  const [showDifferences, setShowDifferences] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<ResultStatusFilter>("all");
  const [sortMode, setSortMode] = useState<ResultSortMode>("name_asc");
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
      }),
    [activeResortItemByItemId, items],
  );
  const mismatchCount = useMemo(() => items.filter(hasDifference).length, [items]);
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
      if (sortMode === "name_desc") return right.product_name.localeCompare(left.product_name, "ru");
      if (sortMode === "group_asc") return (left.group_name ?? "").localeCompare(right.group_name ?? "", "ru");
      if (sortMode === "group_desc") return (right.group_name ?? "").localeCompare(left.group_name ?? "", "ru");
      if (sortMode === "empty_first") {
        const leftEmpty = left.actual_amount === null;
        const rightEmpty = right.actual_amount === null;
        if (leftEmpty !== rightEmpty) return leftEmpty ? -1 : 1;
      }
      if (sortMode === "empty_last") {
        const leftEmpty = left.actual_amount === null;
        const rightEmpty = right.actual_amount === null;
        if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
      }
      if (sortMode === "sum_desc") {
        return Math.abs(Number(right.difference_sum ?? 0)) - Math.abs(Number(left.difference_sum ?? 0));
      }
      return left.product_name.localeCompare(right.product_name, "ru");
    });
  }, [
    activeResortItemByItemId,
    groupFilter,
    items,
    searchQuery,
    showDifferences,
    sortMode,
    statusFilter,
  ]);
  const isTableFiltered =
    showDifferences ||
    searchQuery.trim().length > 0 ||
    groupFilter !== "all" ||
    statusFilter !== "all" ||
    sortMode !== "name_asc";
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
      <div className="rounded-lg border bg-background p-4 text-sm text-muted-foreground">
        Построчных данных по акту нет.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-2">
        <div className="rounded-lg border bg-background p-4">
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
        <div className="rounded-lg border bg-background p-4">
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

      <Tabs defaultValue="results" className="space-y-4">
        <TabsList>
          <TabsTrigger value="results">Итоги</TabsTrigger>
          <TabsTrigger value="journal">Журнал решений</TabsTrigger>
        </TabsList>

        <TabsContent value="results" className="space-y-4">
      <DataTableToolbar
        search={{
          value: searchQuery,
          onChange: setSearchQuery,
          open: searchOpen,
          onOpenChange: setSearchOpen,
          placeholder: "Поиск по позиции, артикулу, группе",
        }}
        filters={{
          active: isTableFiltered,
          content: (
            <div className="space-y-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Фильтры
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showDifferences}
                  onChange={(event) => setShowDifferences(event.target.checked)}
                  className="h-4 w-4 rounded border-input accent-primary"
                />
                Показывать только расхождения
              </label>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Группа</label>
                <select
                  value={groupFilter}
                  onChange={(event) => setGroupFilter(event.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="all">Все группы</option>
                  {groupOptions.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Статус</label>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as ResultStatusFilter)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="all">Все</option>
                  <option value="included">Учитывать</option>
                  <option value="excluded">Не учитывать</option>
                  <option value="resort">Пересорт</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Сортировка</label>
                <select
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as ResultSortMode)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="name_asc">Название: А-Я</option>
                  <option value="name_desc">Название: Я-А</option>
                  <option value="group_asc">Группа: А-Я</option>
                  <option value="group_desc">Группа: Я-А</option>
                  <option value="empty_first">Пустые сверху</option>
                  <option value="empty_last">Пустые снизу</option>
                  <option value="sum_desc">Сумма расхождения</option>
                </select>
              </div>
              {isTableFiltered ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start px-0"
                  onClick={() => {
                    setShowDifferences(false);
                    setSearchQuery("");
                    setGroupFilter("all");
                    setStatusFilter("all");
                    setSortMode("name_asc");
                  }}
                >
                  Сбросить фильтры
                </Button>
              ) : null}
            </div>
          ),
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
        actions={
          canAdjust ? (
            <>
              <Button
                type="button"
                size="sm"
                disabled={isFinalized || isPending || selectedItems.length < 2}
                onClick={() => createResort(Array.from(selectedIds))}
              >
                Пересорт
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
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
            </>
          ) : null
        }
        summary={
          <>
            Показано {visibleItems.length} из {items.length}; расхождений {mismatchCount}; выбрано {selectedItems.length}.
          </>
        }
      />

      {suggestions.length > 0 ? (
      <div className="rounded-lg border bg-background p-4">
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
        <div className="rounded-lg border bg-background p-4 text-sm">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 className="h-4 w-4" />
            Расхождений по строкам нет.
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-background">
          <div
            className="grid items-center border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground"
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
        <div className="rounded-lg border bg-background p-4">
          <div className="mb-3 text-sm font-medium">Активные пересорты</div>
          <div className="grid gap-2">
            {activeResorts.map((resort) => (
              <div key={resort.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-medium">{resort.group_name ?? "Группа"} · {formatAmount(resort.offset_amount, amountRoundingScale)} ед.</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Остаток: недостача {formatMoney(Math.abs(resort.residual_shortfall_sum ?? 0), "RUB", amountRoundingScale)}, излишек {formatMoney(Math.abs(resort.residual_surplus_sum ?? 0), "RUB", amountRoundingScale)}
                  </div>
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

      {canFinalize ? (
        <div className="flex flex-col gap-3 rounded-lg border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium">
              {isFinalized ? "Итоги подведены" : "Подведение итогов"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              После подведения итогов пересорты, комментарии и исключения будут заблокированы до переоткрытия.
            </div>
          </div>
          {isFinalized ? (
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
            <Button
              type="button"
              disabled={isPending}
              onClick={() =>
                runAction(
                  () => finalizeInventoryResults({ documentId }),
                  "Итоги подведены",
                )
              }
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Подвести итоги
            </Button>
          )}
        </div>
      ) : null}
        </TabsContent>

        <TabsContent value="journal">
      <div className="rounded-lg border bg-background p-4">
        <div className="mb-3 text-sm font-medium">Журнал решений</div>
        {events.length === 0 ? (
          <div className="text-sm text-muted-foreground">Действий по итогам пока нет.</div>
        ) : (
          <div className="grid gap-2">
            {events.map((event) => {
              const reason = payloadReason(event.payload);
              const resortText = event.event_type === "resort_created" ? payloadResortText(event.payload) : null;
              const comment = event.event_type === "comment_updated" ? payloadComment(event.payload) : null;
              return (
                <div key={event.id} className="flex gap-3 rounded-md border p-3 text-sm">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium">
                    {event.actor?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={event.actor.avatar_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      actorInitials(event.actor, event.created_by)
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{actorName(event.actor, event.created_by)}</span>
                      <Badge variant="outline">{eventTypeLabel(event.event_type)}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(event.created_at).toLocaleString("ru-RU")}
                      </span>
                    </div>
                    <div className="mt-1 text-sm">{event.message}</div>
                    {resortText ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Зачет: {resortText}
                      </div>
                    ) : null}
                    {comment ? <div className="mt-1 text-xs text-muted-foreground">Комментарий: {comment}</div> : null}
                    {reason ? <div className="mt-1 text-xs text-muted-foreground">Причина: {reason}</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
        </TabsContent>
      </Tabs>

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
    </div>
  );
}
