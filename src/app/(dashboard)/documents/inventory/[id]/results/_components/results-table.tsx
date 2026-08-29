"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { arrayMove } from "@dnd-kit/sortable";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Ban,
  Check,
  CheckCircle2,
  ChevronRight,
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

import { bulkCreateInventoryResultExclusionRules, bulkSetInventoryResultItemsExcluded, createInventoryResultExclusionRule, deleteInventoryResultExclusionRule, setInventoryResultItemExcluded } from "@/app/(dashboard)/inventory/_actions/exclusions";
import { bulkSetRecountFlag, setRecountFlag } from "@/app/(dashboard)/inventory/_actions/recount";
import { createInventoryResultResort, dismissInventoryResortSuggestion, getAiResortSuggestions, voidInventoryResultResort } from "@/app/(dashboard)/inventory/_actions/resort";
import { finalizeInventoryResults, reopenInventoryResults, updateInventoryResultComment } from "@/app/(dashboard)/inventory/_actions/results";
import {
  calculateManagementTotals,
  type InventoryResortAllocationItem,
} from "@/lib/inventory/results";
import type { ResortSuggestion } from "@/lib/inventory/resort-suggestions";
import {
  COLUMN_TO_RESULT_FIELD,
  RESULT_SORT_CODEC,
  RESULT_COLUMNS,
  RESULT_RECOUNT_LABEL,
  RESULT_SORT_FIELD_LABEL,
  RESULT_STATUS_LABEL,
  RESULTS_TABLE_ID,
  hasDifference,
  isOpenDifference,
  resultSortToDirection,
  resultSortToField,
  type ResultColumnKey,
  type ResultRecountFilter,
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
  formatMoney,
  formatSignedMoney,
  signedAmountClass,
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
  TablePagination,
  useTableState,
  type ManagedTableColumn,
  type TableStateColumn,
  ResizableTableHead,
  useMultiSort,
} from "@/components/shared/table";
import { cn } from "@/lib/utils";
import { IngredientOverviewSheet } from "./ingredient-overview-sheet";
import { RefreshResultsButton } from "./refresh-results-button";
import { RecountSplitDialog } from "./recount-split-dialog";

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
  /** Строка исключена именно правилом, а не вручную (миграция 231). */
  excluded_by_rule?: boolean;
  exclusion_rule_reason: string | null;
  needs_recount: boolean | null;
  recount_auto_flagged: boolean | null;
  recount_note: string | null;
  /** Факт на момент последней отправки на пересчёт (снимок «было»).
      Не null → строка была на пересчёте (постоянная пометка). */
  recount_previous_amount: number | null;
  /** Исключение из итогов на момент фиксации (миграция 227). */
  finalized_excluded_from_totals?: boolean | null;
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
  created_at: string;
  void_reason: string | null;
  /** Снимок пересорта на момент подведения итогов (миграция 227). У
      зафиксированного акта страница подставляет эти значения в поля выше —
      см. applyResortSnapshot. */
  finalized_at?: string | null;
  finalized_status?: string | null;
  finalized_offset_amount?: number | null;
  finalized_residual_shortfall_sum?: number | null;
  finalized_residual_surplus_sum?: number | null;
  finalized_cost_adjustment_sum?: number | null;
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
  /** Когда сняли снимок построчных итогов (миграция 221). Не null → в таблице
      зафиксированные числа, а не живые из Quick Resto. */
  resultsSnapshotAt: string | null;
  /** Дата акта (ISO) — для развилки «пересчёт сегодня / другим днём». */
  documentInvoiceDate: string | null;
  /** Акты пересчёта, в которые вынесены позиции этого акта. */
  recountSplits: Array<{
    documentId: string;
    documentNumber: string;
    invoiceDate: string | null;
    status: string;
    itemCount: number;
  }>;
  /** Read-only: финализирован ИЛИ проведён в QR и не разблокирован. */
  isLocked: boolean;
  canComment: boolean;
  canAdjust: boolean;
  canFinalize: boolean;
  canRecount: boolean;
  /** inventory.view_results — держатель права может «Обновить итоги»
      (перечитать из QR). Назначенный исполнитель, просто смотрящий проведённый
      акт, этого права не имеет → кнопка ему не показывается (read-only). */
  canRefreshResults: boolean;
  /** inventory.view_products — нужно, чтобы открыть карточку ингредиента
      из «Итогов» (та же граница, что у каталога). */
  canViewProducts: boolean;
  aiSuggestionsEnabled: boolean;
  documentStatus: string;
  /** Акт с зафиксированными итогами распровели в Quick Resto (миграция 224). */
  qrUnprocessedAt: string | null;
  /** Суммы, которые сам Quick Resto записал в акт при проведении (миграция 225).
      До проведения QR отдаёт нули, поэтому здесь null. */
  qrShortfallSum: number | null;
  qrSurplusSum: number | null;
};

// Количество в Итогах показываем точнее, чем деньги: денежная шкала
// (amountRoundingScale, по умолчанию десятые) скрывала бы сотые, введённые
// исполнителем, — план и факт «сходились» визуально при ненулевой разнице в
// управленческой сумме. Поэтому количества — до 3 знаков (целые без «,0»,
// хвостовые нули обрезаются). Деньги (Сумма/итоги) остаются на шкале аккаунта.
const RESULT_QUANTITY_MAX_FRACTION = 3;

// Две суммы в тайлах — РАЗНЫЕ величины, и раньше подписи это скрывали («По QR»
// против «К списанию» читалось как «столько насчитал QR» / «столько спишем»).
// На деле исключения из итогов и пересорты — управленческая надстройка: в
// Quick Resto проводится полная разница по строкам, независимо от них.
const QR_TILE_HINT =
  "Полная разница по строкам — ровно она проводится в Quick Resto. Исключения из итогов и пересорты на неё не влияют.";
const MANAGEMENT_TILE_HINT =
  "Наша оценка: с учётом исключённых строк и пересортов. Остаётся внутри CRM, в Quick Resto не уходит.";

/**
 * Уверенность предложения пересорта — полукруглой шкалой.
 *
 * Дуга вместо полоски: значение читается по заполненности сектора, а число
 * стоит внутри неё, а не отдельной строкой ниже. На карточке высотой в три
 * строки это экономит вертикаль и даёт один якорь для взгляда вместо двух.
 *
 * Геометрия в единицах viewBox: полуокружность радиусом 16 от (4,20) до
 * (36,20). Длина дуги = πr, ею же задаём dasharray/dashoffset — так процент
 * отображается ровно долей дуги, без тригонометрии.
 *
 * Цвета — токенами (stroke-border / stroke-brand), поэтому тёмная тема
 * получается сама. Дорожка именно border, а не muted: muted (240 5% 96%)
 * почти неотличим от фона страницы (0 0% 98%), и незаполненная часть дуги
 * пропадала — по шкале нельзя было понять, 70 это из 100 или из 80.
 */
function ConfidenceGauge({ percent }: { percent: number }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const arcLength = Math.PI * 16;
  const arc = "M 4 20 A 16 16 0 0 1 36 20";
  return (
    <svg
      viewBox="0 0 40 22"
      className="w-12 overflow-visible"
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Уверенность предложения"
    >
      <path d={arc} fill="none" strokeWidth="4" strokeLinecap="round" className="stroke-border" />
      <path
        d={arc}
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        className="stroke-brand"
        strokeDasharray={arcLength}
        strokeDashoffset={arcLength * (1 - value / 100)}
      />
      <text
        x="20"
        y="20"
        textAnchor="middle"
        fontSize="10"
        className="fill-foreground font-medium"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}%
      </text>
    </svg>
  );
}

function formatQuantity(
  value: number | null | undefined,
  measureUnitName: string | null | undefined,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: RESULT_QUANTITY_MAX_FRACTION,
  }).format(value);
  return `${formatted} ${measureUnitName ?? "ед."}`;
}

// Пересчитанное значение совпало с прежним. Это законный исход («пересчитали,
// значение подтвердилось»), но он должен читаться именно так: «было 3 → стало
// 3» само по себе неотличимо от акта, где пересчёт не делали.
function amountsMatch(left: number | null | undefined, right: number | null | undefined) {
  if (typeof left !== "number" || typeof right !== "number") return false;
  return Math.abs(left - right) < 0.000001;
}

export function InventoryResultsTable({
  documentId,
  items,
  resorts,
  resortItems,
  suggestions,
  amountRoundingScale,
  isFinalized,
  resultsSnapshotAt,
  documentInvoiceDate,
  recountSplits,
  isLocked,
  canComment,
  canAdjust,
  canFinalize,
  canRecount,
  canRefreshResults,
  canViewProducts,
  aiSuggestionsEnabled,
  documentStatus,
  qrUnprocessedAt,
  qrShortfallSum,
  qrSurplusSum,
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
  // Ref на актуальный selectedIds: renderSelectCell читает его, не завися от
  // selectedIds в deps. Иначе каждый клик по чекбоксу пересобирал
  // columnsConfig → stateColumns → useTableState (с эффектами/персистом
  // колонок) → чекбоксы «залипали». Ref обновляем на каждый рендер, чтобы
  // ячейки при перерендере (смена selectedIds) читали свежее значение.
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const [commentItem, setCommentItem] = useState<InventoryDocumentResultItem | null>(null);
  // Боковая панель «Обзор ингредиента» — открывается кликом по названию позиции.
  const [overviewIngredient, setOverviewIngredient] = useState<{ id: string; name: string } | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [deleteRuleItem, setDeleteRuleItem] = useState<InventoryDocumentResultItem | null>(null);
  const [deleteRuleReason, setDeleteRuleReason] = useState("");
  const [voidingResort, setVoidingResort] = useState<InventoryResultResortRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [confirmFinalize, setConfirmFinalize] = useState(false);
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
  // Наименования позиций в каждом активном пересорте — чтобы в блоке «Активные
  // пересорты» было видно, что с чем сводилось (недостача ↔ излишек).
  const itemNameById = useMemo(
    () => new Map(items.map((item) => [item.id, item.product_name])),
    [items],
  );
  const itemUnitById = useMemo(
    () => new Map(items.map((item) => [item.id, item.measure_unit_name])),
    [items],
  );
  // Единица измерения пересорта — с любой его позиции: пересорт по построению
  // сводит позиции ОДНОЙ единицы (calculateResortAllocation это проверяет).
  const resortUnitByResortId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const resortItem of resortItems) {
      if (map.has(resortItem.resortId)) continue;
      map.set(resortItem.resortId, itemUnitById.get(resortItem.documentItemId) ?? null);
    }
    return map;
  }, [resortItems, itemUnitById]);
  const resortNamesByResortId = useMemo(() => {
    const map = new Map<string, { shortage: string[]; surplus: string[] }>();
    for (const resortItem of resortItems) {
      if (!activeResortIds.has(resortItem.resortId)) continue;
      const entry = map.get(resortItem.resortId) ?? { shortage: [], surplus: [] };
      const name = itemNameById.get(resortItem.documentItemId) ?? "Позиция";
      (resortItem.role === "shortage" ? entry.shortage : entry.surplus).push(name);
      map.set(resortItem.resortId, entry);
    }
    return map;
  }, [resortItems, activeResortIds, itemNameById]);
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
  // Что реально уйдёт в проводку (полная разница по строкам) против нашей
  // управленческой оценки. Обе цифры показываем в подтверждении финализации:
  // проверяющий не должен узнавать о разнице уже после проведения.
  const qrNetSum = totals.qrSurplusSum + totals.qrShortfallSum;
  const managementNetSum = totals.managementSurplusSum + totals.managementShortfallSum;
  const finalizeSumsDiffer = Math.abs(qrNetSum - managementNetSum) > 0.005;
  const hasQrDocumentSums = qrShortfallSum != null || qrSurplusSum != null;
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
      // «Был на пересчёте» — постоянная пометка по снимку «было».
      if (recountFilter === "recounted" && item.recount_previous_amount == null) return false;

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
  // Массовые действия в итогах — это пометка на пересчёт и исключение из
  // итогов; без соответствующих прав их панель не рендерится.
  const canBulkAct = canAdjust || canRecount;
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  );

  // Фильтр или поиск скрыл строку — снимаем с неё выделение. Иначе массовое
  // действие применялось к позициям, которых человек на экране не видит:
  // «выбрать все» скоупится по видимым, а вот выделенное раньше оставалось.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(visibleItems.map((item) => item.id));
      const next = new Set<string>();
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [visibleItems]);

  // Строки, которые вообще можно выбрать (тот же предикат, что в renderSelectCell):
  // не залочено редактирование, не исключено из итогов, нет активной пересортицы.
  // Базируемся на visibleItems (то, что реально рендерит таблица с учётом
  // поиска/фильтров), а не на полном items — иначе «выбрать все» захватило бы
  // скрытые строки, и массовые действия применились бы к невидимым позициям.
  const selectableItems = useMemo(
    () =>
      visibleItems.filter((item) => {
        const resortItem = activeResortItemByItemId.get(item.id);
        const isExcluded = item.excluded_from_totals === true;
        return !adjustLocked && !isExcluded && !resortItem;
      }),
    [visibleItems, activeResortItemByItemId, adjustLocked],
  );
  const allSelectableSelected =
    selectableItems.length > 0 && selectableItems.every((item) => selectedIds.has(item.id));
  const someSelectableSelected = selectableItems.some((item) => selectedIds.has(item.id));
  const selectAllState: boolean | "indeterminate" = allSelectableSelected
    ? true
    : someSelectableSelected
      ? "indeterminate"
      : false;
  const toggleSelectAll = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allSelectableSelected) {
        selectableItems.forEach((item) => next.delete(item.id));
      } else {
        selectableItems.forEach((item) => next.add(item.id));
      }
      return next;
    });
  };

  const runAction = useCallback(
    (
      // notice — когда экшен отработал не совсем так, как ожидал пользователь,
      // и это стоит сказать словами (например: акт уже был проведён в Quick
      // Resto, повторное проведение не потребовалось).
      action: () => Promise<{ error: string | null; notice?: string }>,
      success: string,
      onSuccess?: () => void,
    ) => {
      startTransition(async () => {
        const result = await action();
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success(result.notice ?? success);
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

  const { cycleSort, headerIndicator, headerAriaSort, sortableColumnIds } = useMultiSort({
    sorts,
    onChange: setSorts,
    columnToField: COLUMN_TO_RESULT_FIELD,
    codec: RESULT_SORT_CODEC,
  });

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

  // Какое обоснование раскрыто. Одно за раз: карточка-«очередь» должна
  // оставаться сканируемой.
  const [openReasonKey, setOpenReasonKey] = useState<string | null>(null);
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

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
            {formatQuantity(item.calculated_amount, item.measure_unit_name)}
          </span>
        );
      }
      if (key === "fact") {
        return <span>{formatQuantity(item.actual_amount, item.measure_unit_name)}</span>;
      }
      if (key === "difference") {
        return (
          <span className={signedAmountClass(item.difference_amount)}>
            {formatQuantity(item.difference_amount, item.measure_unit_name)}
          </span>
        );
      }
      if (key === "management") {
        return (
          <span className={signedAmountClass(managementSum)}>
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
              {item.excluded_by_rule ? (
                <div className="text-[11px] text-muted-foreground">Авто</div>
              ) : null}
            </div>
          </div>
        );
      }
      if (key === "recount") {
        const flagged = Boolean(item.needs_recount);
        const auto = Boolean(item.recount_auto_flagged);
        const wasRecounted = item.recount_previous_amount != null;
        const recountUnchanged =
          wasRecounted && amountsMatch(item.recount_previous_amount, item.actual_amount);
        return (
          <div className="flex flex-col gap-1" data-row-interactive>
          <div className="flex items-center gap-2">
            <Tooltip delayDuration={450}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="switch"
                  aria-checked={flagged}
                  aria-label={
                    flagged ? "Снять пометку пересчёта" : "Отправить строку на пересчёт"
                  }
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
                >
                  <span
                    className={cn(
                      "h-4 w-4 rounded-full bg-background shadow transition-transform",
                      flagged ? "translate-x-5" : "translate-x-1",
                    )}
                  />
                </button>
              </TooltipTrigger>
              {/* Наша подсказка вместо нативного title: тот рисуется средствами
                  ОС, выглядит инородно и появляется с секундной задержкой. Текст
                  тоже переписан — «threshold заведения» ничего не объясняло
                  человеку, который этот порог задаёт в карточке заведения. */}
              <TooltipContent sideOffset={6} className="max-w-[260px]">
                {flagged
                  ? auto
                    ? "Отмечено автоматически: расхождение больше порога, заданного для заведения. Нажмите, чтобы снять."
                    : "Отметил проверяющий. Нажмите, чтобы снять."
                  : "Нажмите, чтобы отправить строку на пересчёт."}
              </TooltipContent>
            </Tooltip>
            {flagged && auto ? <span className="text-[11px] text-muted-foreground">Авто</span> : null}
          </div>
          {wasRecounted ? (
            // Постоянный след пересчёта: «было → стало», чтобы проверяющий
            // сравнил исходный факт с пересчитанным (см. recount_previous_amount).
            <span
              className="text-[11px] text-rose-700 dark:text-rose-300"
              title={
                recountUnchanged
                  ? "Строку пересчитали — значение подтвердилось"
                  : "Строка была отправлена на пересчёт"
              }
            >
              было {formatQuantity(item.recount_previous_amount, item.measure_unit_name)} → {formatQuantity(item.actual_amount, item.measure_unit_name)}
              {recountUnchanged ? (
                <span className="text-muted-foreground"> · не изменилось</span>
              ) : null}
            </span>
          ) : null}
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
            checked={selectedIdsRef.current.has(item.id)}
            disabled={!isSelectable}
            onCheckedChange={() => toggleSelected(item.id)}
            aria-label={`Выбрать ${item.product_name}`}
          />
        </span>
      );
    },
    // selectedIds намеренно НЕ в deps — читаем через ref (см. selectedIdsRef).
    [activeResortItemByItemId, adjustLocked],
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
      // Колонка выделения нужна только тем, кому доступны массовые действия:
      // без прав человек мог отмечать строки, а bulk-панель не появлялась —
      // выделение вело в никуда.
      ...(canBulkAct
        ? [{ id: "select", label: "", size: 44, canHide: false, cell: renderSelectCell }]
        : []),
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
              {item.group_name ?? "Без группы"}
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
    [canBulkAct, canViewProducts, renderActionsCell, renderResultCell, renderSelectCell],
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
      pagination: tableState.pagination,
    },
    getRowId: (row) => row.id,
    columnResizeMode: "onChange",
    onColumnVisibilityChange: tableState.setColumnVisibility,
    onColumnOrderChange: tableState.setColumnOrder,
    onColumnSizingChange: tableState.setColumnSizing,
    onPaginationChange: tableState.setPagination,
    getCoreRowModel: getCoreRowModel(),
    // Клиентская пагинация: все строки итогов уже на руках.
    getPaginationRowModel: getPaginationRowModel(),
    // autoResetPageIndex выключен: иначе router.refresh() после действия над
    // строкой (напр. «Не учитывать») менял data → tanstack сбрасывал на 1-ю
    // страницу. Сброс на 1-ю страницу при смене фильтров/сортировки делаем сами
    // отдельным эффектом (см. ниже).
    autoResetPageIndex: false,
  });

  // Страница пагинации Итогов, устойчивая к: (1) действиям над строкой
  // (autoResetPageIndex выключен — router.refresh() не сбрасывает на 1-ю);
  // (2) перезагрузке страницы — запоминаем в sessionStorage per-акт.
  const { setPagination: setTablePagination } = tableState;
  const currentPageIndex = tableState.pagination.pageIndex;
  const currentPageSize = tableState.pagination.pageSize;
  const pageStorageKey = `sheerly-inventory-results-page:${documentId}`;
  // Кламп страницы, когда выборка сузилась БЕЗ смены фильтров (autoResetPageIndex
  // выключен): напр. исключили последнюю видимую строку на последней странице —
  // pageIndex оказался бы за пределами и таблица показала бы пустоту. Держим
  // pageIndex в диапазоне на каждый рендер (не только при гидрации).
  useEffect(() => {
    const maxIndex = Math.max(0, Math.ceil(visibleItems.length / currentPageSize) - 1);
    if (currentPageIndex > maxIndex) {
      setTablePagination((current) => ({ ...current, pageIndex: maxIndex }));
    }
  }, [visibleItems.length, currentPageSize, currentPageIndex, setTablePagination]);
  // Гидрация из sessionStorage один раз на акт (в state изначально pageIndex=0).
  const pageHydratedRef = useRef(false);
  useEffect(() => {
    if (pageHydratedRef.current) return;
    pageHydratedRef.current = true;
    const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(pageStorageKey) : null;
    const storedIndex = raw ? Number(raw) : 0;
    if (!Number.isFinite(storedIndex) || storedIndex <= 0) return;
    setTablePagination((current) => {
      // Кламп: если позиций стало меньше — не застреваем за последней страницей.
      const maxIndex = Math.max(0, Math.ceil(visibleItems.length / current.pageSize) - 1);
      const pageIndex = Math.min(storedIndex, maxIndex);
      return pageIndex === current.pageIndex ? current : { ...current, pageIndex };
    });
  }, [pageStorageKey, setTablePagination, visibleItems.length]);
  // Персист текущей страницы.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(pageStorageKey, String(currentPageIndex));
  }, [pageStorageKey, currentPageIndex]);

  // При РЕАЛЬНОЙ смене фильтров/поиска/сортировки возвращаемся на 1-ю страницу
  // (иначе можно застрять на пустой странице после сужения выборки). Пропускаем
  // первый прогон (mount), чтобы не перетереть гидрацию сохранённой страницы.
  const filtersInitRef = useRef(false);
  useEffect(() => {
    if (!filtersInitRef.current) {
      filtersInitRef.current = true;
      return;
    }
    setTablePagination((current) =>
      current.pageIndex === 0 ? current : { ...current, pageIndex: 0 },
    );
  }, [showDifferences, searchQuery, groupFilter, statusFilter, recountFilter, sorts, setTablePagination]);

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
      {/* Акт распровели в Quick Resto: наши итоги остались зафиксированными,
          но источник правды больше не считает акт проведённым. Молча
          откатывать статус нельзя — показываем это человеку. */}
      {qrUnprocessedAt ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-500/5 px-4 py-3 dark:border-amber-500/40 dark:bg-amber-500/10">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <div className="min-w-0 text-sm">
            <div className="font-medium text-amber-800 dark:text-amber-200">
              Акт распровели в Quick Resto
            </div>
            <p className="mt-0.5 text-amber-800/90 dark:text-amber-300/90">
              Итоги у нас остались зафиксированными — здесь по-прежнему снимок,
              утверждённый при подведении итогов. Чтобы провести акт заново,
              разблокируйте его и подведите итоги ещё раз.
            </p>
          </div>
        </div>
      ) : null}

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

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border bg-card p-3 sm:p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Недостача</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs text-muted-foreground" title={QR_TILE_HINT}>
                Уйдёт в Quick Resto
              </div>
              <div className="mt-1 text-xl font-semibold text-red-700 dark:text-red-400 sm:text-2xl">
                {formatMoney(Math.abs(totals.qrShortfallSum), "RUB", amountRoundingScale)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground" title={MANAGEMENT_TILE_HINT}>
                Управленческая оценка
              </div>
              <div className="mt-1 text-xl font-semibold text-red-700 dark:text-red-400 sm:text-2xl">
                {formatMoney(Math.abs(totals.managementShortfallSum), "RUB", amountRoundingScale)}
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3 sm:p-4">
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
              <div className="text-xs text-muted-foreground" title={QR_TILE_HINT}>
                Уйдёт в Quick Resto
              </div>
              <div className="mt-1 text-xl font-semibold text-green-700 dark:text-green-400 sm:text-2xl">
                {formatMoney(Math.abs(totals.qrSurplusSum), "RUB", amountRoundingScale)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground" title={MANAGEMENT_TILE_HINT}>
                Управленческая оценка
              </div>
              <div className="mt-1 text-xl font-semibold text-green-700 dark:text-green-400 sm:text-2xl">
                {formatMoney(Math.abs(totals.managementSurplusSum), "RUB", amountRoundingScale)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Суммы, которые Quick Resto записал в акт при проведении. До проведения
          QR отдаёт по документу нули, поэтому строка появляется только у
          проведённого акта. Раньше эти числа сохранялись, но не доходили ни до
          одного экрана: их перетирал управленческий итог. */}
      {hasQrDocumentSums ? (
        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:px-4">
          <span className="font-medium text-foreground">Quick Resto при проведении:</span>{" "}
          недостача {formatMoney(Math.abs(qrShortfallSum ?? 0), "RUB", amountRoundingScale)} · излишек{" "}
          {formatMoney(Math.abs(qrSurplusSum ?? 0), "RUB", amountRoundingScale)} · итого{" "}
          {formatSignedMoney(
            Math.abs(qrSurplusSum ?? 0) - Math.abs(qrShortfallSum ?? 0),
            "RUB",
            amountRoundingScale,
          )}
        </div>
      ) : null}

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
          secondaryActions={
            <>
              {canRequestAi || aiLoading ? (
                <Tooltip delayDuration={450}>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        disabled={aiLoading || isPending}
                        onClick={requestAiSuggestions}
                        aria-label="Подсказки пересорта (ИИ)"
                        className="h-8 w-8 border-border text-blue-600 hover:border-blue-400 hover:bg-background hover:text-blue-600 dark:text-blue-400 [&_svg]:h-3.5 [&_svg]:w-3.5 sm:h-9 sm:w-9 sm:[&_svg]:h-4 sm:[&_svg]:w-4"
                      >
                        {aiLoading ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <WandSparkles />
                        )}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={6}>Подсказки пересорта (ИИ)</TooltipContent>
                </Tooltip>
              ) : null}
              {canRefreshResults && !isLocked ? (
                <RefreshResultsButton documentId={documentId} />
              ) : null}
            </>
          }
          summary={
            <>
              Показано {visibleItems.length} из {items.length}; расхождений {mismatchCount}
              {resultsSnapshotAt ? (
                <> · итоги зафиксированы {new Date(resultsSnapshotAt).toLocaleDateString("ru-RU")}</>
              ) : null}
            </>
          }
        />
      </div>

      {recountSplits.length > 0 ? (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-900 dark:text-blue-200">
          {recountSplits.map((split) => (
            <div key={split.documentId} className="flex flex-wrap items-center gap-1">
              <span>
                {split.itemCount} {pluralRu(split.itemCount, "позиция вынесена", "позиции вынесены", "позиций вынесено")} в
              </span>
              <Link href={`/documents/inventory/${split.documentId}/results`} className="font-medium underline underline-offset-2">
                акт пересчёта № {split.documentNumber}
              </Link>
              {split.invoiceDate ? (
                <span>от {new Date(split.invoiceDate).toLocaleDateString("ru-RU")}</span>
              ) : null}
              <span className="text-blue-900/70 dark:text-blue-200/70">
                — расхождение по ним считается на дату пересчёта
              </span>
            </div>
          ))}
        </div>
      ) : null}

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

      {/* Карточка с предложениями пересорта. Триггер ИИ-подсказок переехал
          в тулбар (синяя иконка-палочка). Карточка показывается только
          когда есть что показать: готовые подсказки или идёт загрузка ИИ. */}
      {displayedSuggestions.length > 0 || aiLoading ? (
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <WandSparkles className="h-4 w-4 text-blue-600" />
          <div className="text-sm font-medium">Предложения пересорта</div>
          {aiSuggestionsEnabled ? <Badge variant="outline">AI</Badge> : <Badge variant="secondary">История</Badge>}
        </div>
        {displayedSuggestions.length > 0 ? (
        <div className="grid gap-1.5">
            {displayedSuggestions.map((suggestion) => {
              // Строка фактов вместо прозы: числа, ради которых предложение и
              // читают, вынесены отдельными полями. Считаем по itemIds из уже
              // загруженных строк акта — обе ветки (история и ИИ) отдают
              // только текстовое обоснование, а цифры лежат здесь.
              const parts = suggestion.itemIds
                .map((id) => itemById.get(id))
                .filter((row): row is InventoryDocumentResultItem => Boolean(row));
              const surplus = parts.filter((row) => (row.difference_amount ?? 0) > 0);
              const shortage = parts.filter((row) => (row.difference_amount ?? 0) < 0);
              const groupName = parts.find((row) => row.group_name)?.group_name ?? null;
              const percent = Math.round(suggestion.confidence * 100);
              const reasonOpen = openReasonKey === suggestion.key;
              return (
                <div key={suggestion.key} className="flex gap-3 rounded-md border p-3">
                  {/* Уверенность — слева и шкалой: её сравнивают между
                      предложениями, а взглядом по левому краю это делается
                      за один проход. Раньше процент стоял в конце длинной
                      серой строки, разной длины у каждой карточки. */}
                  <div className="flex w-12 shrink-0 flex-col items-center gap-0.5 pt-0.5">
                    <ConfidenceGauge percent={percent} />
                    <span className="text-[11px] leading-tight text-muted-foreground">
                      {suggestion.source === "ai" ? "ИИ" : "История"}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{suggestion.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      {surplus.map((row) => (
                        <span key={`s-${row.id}`} className={cn("tabular-nums", signedAmountClass(row.difference_amount))}>
                          +{formatQuantity(Math.abs(Number(row.difference_amount ?? 0)), row.measure_unit_name)}
                        </span>
                      ))}
                      {surplus.length > 0 && shortage.length > 0 ? (
                        <span className="text-muted-foreground">·</span>
                      ) : null}
                      {shortage.map((row) => (
                        <span key={`d-${row.id}`} className={cn("tabular-nums", signedAmountClass(row.difference_amount))}>
                          {formatQuantity(row.difference_amount, row.measure_unit_name)}
                        </span>
                      ))}
                      {groupName ? (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">{groupName}</span>
                        </>
                      ) : null}
                    </div>
                    {/* Обоснование сворачиваем: у истории это одна строка, у ИИ
                        — три, и в развёрнутом виде оно распирало карточку так,
                        что список предложений переставал читаться списком. */}
                    <button
                      type="button"
                      onClick={() => setOpenReasonKey(reasonOpen ? null : suggestion.key)}
                      aria-expanded={reasonOpen}
                      className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <ChevronRight className={cn("h-3 w-3 transition-transform", reasonOpen && "rotate-90")} />
                      Почему
                    </button>
                    {reasonOpen ? (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{suggestion.reason}</p>
                    ) : null}
                  </div>

                  {canAdjust ? (
                    <div className="flex shrink-0 items-start gap-2">
                      <Button type="button" size="sm" variant="ghost" disabled={adjustLocked || isPending} onClick={() => dismissSuggestion(suggestion)}>
                        Скрыть
                      </Button>
                      {/* Иерархия действий без заливки: предложений бывает до
                          восьми, и восемь brand-кнопок подряд превращаются в
                          стену. outline против ghost её задаёт достаточно. */}
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
              );
            })}
        </div>
        ) : (
          // Карточка рендерится при aiLoading и пустом списке — показываем
          // индикатор подбора. (aiRequested+пусто → карточка скрыта, а юзер
          // получает toast «ИИ не нашёл подходящих пересортов».)
          <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Подбираем варианты пересорта…
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
        // На десктопе (md+) overflow видимый: колонки вписаны в ширину
        // (table-fixed + colgroup в %), шапка липнет к верху страницы.
        // На мобильном включаем горизонтальный скролл и держим естественную
        // ширину таблицы (minWidth = сумма размеров колонок) — иначе колонки
        // схлопываются и контент наезжает друг на друга. Trade-off: на узких
        // экранах sticky-шапка не липнет (контейнер скролла её «ловит»).
        <div className="overflow-x-auto rounded-lg border bg-card md:overflow-x-visible">
            {/*
              suppressHydrationWarning: расширения браузера (TableConvert и пр.)
              дописывают на <table> атрибуты `data-tableconvert-*` между SSR и
              hydration → React ругается на mismatch. Атрибуты безвредны.

              md:!min-w-0 снимает inline-minWidth на десктопе (важно: иначе при
              узком окне < суммы колонок таблица переполняла бы карточку без
              скролла, т.к. md:overflow-x-visible). На md+ таблица снова просто
              вписывается в контейнер (table-fixed + %).
            */}
            <table
              suppressHydrationWarning
              className="w-full table-fixed md:!min-w-0"
              style={{ minWidth: `${table.getTotalSize()}px` }}
            >
              <ResizableTableHead
                table={table}
                isControlColumn={(columnId) => columnId === "select" || columnId === "actions"}
                sortableColumnIds={sortableColumnIds}
                onSort={(columnId) => cycleSort(COLUMN_TO_RESULT_FIELD[columnId])}
                headerIndicator={headerIndicator}
                headerAriaSort={headerAriaSort}
                renderControlHeader={(header) =>
                  header.column.id === "select" ? (
                    <Checkbox
                      checked={selectAllState}
                      disabled={selectableItems.length === 0}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Выбрать все строки"
                    />
                  ) : null
                }
              />
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

      {visibleItems.length > 0 ? (
        <TablePagination
          pageIndex={tableState.pagination.pageIndex}
          pageSize={tableState.pagination.pageSize}
          total={visibleItems.length}
          onPageChange={(pageIndex) =>
            tableState.setPagination((current) => ({ ...current, pageIndex }))
          }
          onPageSizeChange={(pageSize) => tableState.setPagination({ pageIndex: 0, pageSize })}
        />
      ) : null}

      {activeResorts.length > 0 ? (
        <div className="rounded-lg border bg-card p-4">
          <div className="mb-3 text-sm font-medium">Активные пересорты</div>
          <div className="grid gap-2">
            {activeResorts.map((resort) => (
              <div key={resort.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-medium">{resort.group_name ?? "Группа"} · {formatQuantity(resort.offset_amount, resortUnitByResortId.get(resort.id))}</div>
                  {(() => {
                    const names = resortNamesByResortId.get(resort.id);
                    if (!names || (names.shortage.length === 0 && names.surplus.length === 0)) {
                      return null;
                    }
                    return (
                      <div className="mt-1 text-xs text-foreground/80">
                        {names.shortage.length > 0 ? (
                          <span>
                            <span className="text-muted-foreground">Недостача:</span>{" "}
                            {names.shortage.join(", ")}
                          </span>
                        ) : null}
                        {names.shortage.length > 0 && names.surplus.length > 0 ? (
                          <span className="text-muted-foreground"> → </span>
                        ) : null}
                        {names.surplus.length > 0 ? (
                          <span>
                            <span className="text-muted-foreground">Излишек:</span>{" "}
                            {names.surplus.join(", ")}
                          </span>
                        ) : null}
                      </div>
                    );
                  })()}
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
          Показано {visibleItems.length} из {items.length}; расхождений {mismatchCount}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSendToRecount ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    {/* Развилка «сегодня / другим днём»: расчётный остаток в QR
                        привязан к дате акта, поэтому пересчёт другим днём должен
                        уходить в отдельный акт (см. recount-split-dialog). */}
                    <RecountSplitDialog
                      documentId={documentId}
                      documentInvoiceDate={documentInvoiceDate}
                      flaggedCount={flaggedCount}
                      disabled={adjustLocked || isPending}
                    />
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
                        onClick={() => setConfirmFinalize(true)}
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

      {/* Подтверждение проведения. Показываем сумму, которая реально уйдёт в
          Quick Resto: исключения и пересорты её не уменьшают, а раньше тайл
          «К списанию» читался как решение по деньгам. */}
      <Dialog open={confirmFinalize} onOpenChange={(open) => !open && setConfirmFinalize(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Подвести итоги акта</DialogTitle>
            <DialogDescription>
              Акт будет проведён в Quick Resto, а итоги — зафиксированы.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Уйдёт в Quick Resto
              </div>
              <div className="mt-2 grid gap-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Недостача</span>
                  <span className="font-medium text-red-700 dark:text-red-400">
                    {formatMoney(Math.abs(totals.qrShortfallSum), "RUB", amountRoundingScale)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Излишек</span>
                  <span className="font-medium text-green-700 dark:text-green-400">
                    {formatMoney(Math.abs(totals.qrSurplusSum), "RUB", amountRoundingScale)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 border-t pt-1">
                  <span className="text-muted-foreground">Итого</span>
                  <span className="font-semibold">
                    {formatSignedMoney(qrNetSum, "RUB", amountRoundingScale)}
                  </span>
                </div>
              </div>
            </div>
            {finalizeSumsDiffer ? (
              <p className="text-muted-foreground">
                Управленческая оценка — {formatSignedMoney(managementNetSum, "RUB", amountRoundingScale)}.
                Она учитывает исключённые строки и пересорты и остаётся внутри CRM:
                в Quick Resto проводится полная разница по строкам.
              </p>
            ) : null}
            <p className="text-muted-foreground">
              После подведения итогов пересорты, комментарии и исключения будут
              заблокированы до переоткрытия.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmFinalize(false)}>
              Отмена
            </Button>
            <Button
              type="button"
              disabled={isPending}
              onClick={() =>
                runAction(
                  () => finalizeInventoryResults({ documentId }),
                  "Итоги подведены",
                  () => setConfirmFinalize(false),
                )
              }
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Подвести итоги
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                    <Repeat2 className="h-3.5 w-3.5" />
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
                    <Ban className="h-3.5 w-3.5" />
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
                    <XCircle className="h-3.5 w-3.5" />
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
                    <RotateCcw className="h-3.5 w-3.5" />
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
                    <Undo2 className="h-3.5 w-3.5" />
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

