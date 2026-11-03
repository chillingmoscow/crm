/**
 * Управленческие итоги актов инвентаризации: строки с исключениями, активные
 * пересорты и корректировки себестоимости.
 *
 * Один код на два потребителя: колонка «Итоги» в списке актов
 * (list-documents.ts) и месячный снимок удержаний (stock/monthly-snapshot.ts).
 * Если бы арифметика жила в двух местах, сумма в списке и сумма, по которой
 * удерживают, рано или поздно разошлись бы.
 *
 * Для акта с зафиксированными итогами строки, пересорты и исключения берутся
 * из снимка (finalized_*), для остальных - живые: так показывает карточка акта
 * (миграции 221, 227). Статус пересорта тоже из снимка: пересорт, аннулированный
 * после фиксации, не должен задним числом выпадать из утверждённого итога.
 *
 * Без импортов из `@/...`, чтобы node:test мог импортировать файл напрямую.
 */

import {
  calculateManagementTotals,
  type InventoryManagementTotals,
  type InventoryResortAllocationItem,
  type InventoryResultCalculationItem,
} from "./results.ts";
import {
  applyResortItemSnapshot,
  applyResortSnapshot,
  isInventoryResultFrozen,
  resultLineTotals,
  type InventoryResortItemSnapshotRow,
  type InventoryResortSnapshotRow,
  type InventoryResultLineTotalsRow,
} from "./results-snapshot.ts";

export type ManagementTotalsDoc = {
  id: string;
  status: string;
  results_finalized_at: string | null;
  results_reopened_at: string | null;
  results_snapshot_at: string | null;
};
export type ManagementTotalsItemRow = InventoryResultLineTotalsRow & {
  document_id: string;
  id: string;
};
export type ManagementTotalsResortRow = InventoryResortSnapshotRow & {
  id: string;
  document_id: string;
};
export type ManagementTotalsResortItemRow = InventoryResortItemSnapshotRow & {
  document_id: string;
  resort_id: string;
  document_item_id: string;
  role: "shortage" | "surplus";
};

/**
 * Итоги по актам. В результате есть только акты, у которых есть хотя бы одна
 * строка: «нет строк» и «строки с нулевой разницей» - разные состояния, и
 * решать, что с первым делать, должен вызывающий (список показывает ноль,
 * расчёт удержания считает месяц неполным).
 */
export function managementTotalsByDocument(input: {
  docs: ManagementTotalsDoc[];
  items: ManagementTotalsItemRow[];
  resorts: ManagementTotalsResortRow[];
  resortItems: ManagementTotalsResortItemRow[];
}): Map<string, InventoryManagementTotals> {
  const frozenDocIds = new Set(
    input.docs.filter((doc) => isInventoryResultFrozen(doc)).map((doc) => doc.id),
  );

  const resorts = input.resorts.map((resort) =>
    applyResortSnapshot(resort, frozenDocIds.has(resort.document_id)),
  );
  const activeResortIds = new Set(
    resorts.filter((resort) => resort.status === "active").map((resort) => resort.id),
  );

  const itemsByDoc = new Map<string, InventoryResultCalculationItem[]>();
  for (const item of input.items) {
    const list = itemsByDoc.get(item.document_id) ?? [];
    const totals = resultLineTotals(item, frozenDocIds.has(item.document_id));
    list.push({
      id: item.id,
      differenceAmount: totals.differenceAmount,
      differenceSum: totals.differenceSum,
      excluded: totals.excluded,
    });
    itemsByDoc.set(item.document_id, list);
  }

  const resortItemsByDoc = new Map<string, InventoryResortAllocationItem[]>();
  for (const rawResortItem of input.resortItems) {
    // Только активные пересорты (voided не учитываем).
    if (!activeResortIds.has(rawResortItem.resort_id)) continue;
    const resortItem = applyResortItemSnapshot(
      rawResortItem,
      frozenDocIds.has(rawResortItem.document_id),
    );
    const list = resortItemsByDoc.get(resortItem.document_id) ?? [];
    list.push({
      id: resortItem.document_item_id,
      sourceDifferenceAmount: Number(resortItem.source_difference_amount ?? 0),
      sourceDifferenceSum: Number(resortItem.source_difference_sum ?? 0),
      offsetAmount: Number(resortItem.offset_amount ?? 0),
      remainingDifferenceAmount: Number(resortItem.remaining_difference_amount ?? 0),
      remainingDifferenceSum: Number(resortItem.remaining_difference_sum ?? 0),
      role: resortItem.role,
    });
    resortItemsByDoc.set(resortItem.document_id, list);
  }

  const costAdjustmentsByDoc = new Map<string, number[]>();
  for (const resort of resorts) {
    if (resort.status !== "active") continue;
    const value = Number(resort.cost_adjustment_sum ?? 0);
    if (!Number.isFinite(value) || value <= 0) continue;
    const list = costAdjustmentsByDoc.get(resort.document_id) ?? [];
    list.push(value);
    costAdjustmentsByDoc.set(resort.document_id, list);
  }

  const out = new Map<string, InventoryManagementTotals>();
  for (const doc of input.docs) {
    const items = itemsByDoc.get(doc.id);
    if (!items) continue;
    out.set(
      doc.id,
      calculateManagementTotals({
        items,
        resortItems: resortItemsByDoc.get(doc.id) ?? [],
        resortCostAdjustments: costAdjustmentsByDoc.get(doc.id) ?? [],
      }),
    );
  }
  return out;
}
