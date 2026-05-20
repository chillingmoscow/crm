export type InventoryResultCalculationItem = {
  id: string;
  groupId?: string | null;
  measureUnitKey?: string | null;
  differenceAmount: number | null;
  differenceSum: number | null;
  excluded?: boolean | null;
};

export type InventoryResortAllocationItem = {
  id: string;
  sourceDifferenceAmount: number;
  sourceDifferenceSum: number;
  offsetAmount: number;
  remainingDifferenceAmount: number;
  remainingDifferenceSum: number;
  role: "shortage" | "surplus";
};

export type InventoryResortAllocation = {
  offsetAmount: number;
  residualShortfallSum: number;
  residualSurplusSum: number;
  /**
   * Управленческая корректировка себестоимости.
   * Когда пересорт покрывает дорогое товаром с другой (более низкой)
   * себестоимостью — разница цены остаётся реальным убытком компании,
   * который алгоритм по-объёмному покрытию полностью теряет.
   *
   * Формула: max(0, shortageCostPerUnit - surplusCostPerUnit) × offsetAmount,
   * где *CostPerUnit — взвешенная средняя себестоимость по всем
   * shortage/surplus item'ам пересорта.
   *
   * Признаётся **только убыток (>= 0)** — управленческий консерватизм
   * (если излишек дороже недостачи, считаем что мы не можем достоверно
   * признать «прибыль», поэтому корректировку обнуляем).
   *
   * См. docs/handbook/inventory/resort.md.
   */
  costAdjustmentSum: number;
  items: InventoryResortAllocationItem[];
};

export type InventoryManagementTotalsInput = {
  items: Array<{
    id: string;
    differenceAmount: number | null;
    differenceSum: number | null;
    excluded?: boolean | null;
  }>;
  resortItems?: InventoryResortAllocationItem[];
  /**
   * Корректировки себестоимости по активным пересортам акта.
   * Каждый элемент — сумма >= 0 (только убыток, см. calculateResortAllocation).
   * Все они плюсуются к managementShortfallSum: пересорт уравнял объёмы,
   * но компания всё равно потеряла на разнице цен — это реальная
   * недостача в управленческом учёте.
   */
  resortCostAdjustments?: number[];
};

export type InventoryManagementTotals = {
  qrShortfallSum: number;
  qrSurplusSum: number;
  managementShortfallSum: number;
  managementSurplusSum: number;
};

const EPSILON = 0.000001;

function finite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function roundMoney(value: number) {
  if (Math.abs(value) < EPSILON) return 0;
  return Math.round(value * 1000000) / 1000000;
}

function unitSum(amount: number, sum: number) {
  return Math.abs(amount) > EPSILON ? Math.abs(sum) / Math.abs(amount) : 0;
}

function signedRemainderSum(sourceAmount: number, sourceSum: number, remainingAmount: number) {
  if (Math.abs(remainingAmount) < EPSILON) return 0;
  const unit = unitSum(sourceAmount, sourceSum);
  if (unit === 0) return 0;
  return roundMoney(Math.sign(remainingAmount) * Math.abs(remainingAmount) * unit);
}

function addSignedDifference(
  totals: Pick<InventoryManagementTotals, "managementShortfallSum" | "managementSurplusSum">,
  sum: number,
) {
  if (sum < 0) totals.managementShortfallSum = roundMoney(totals.managementShortfallSum + sum);
  if (sum > 0) totals.managementSurplusSum = roundMoney(totals.managementSurplusSum + sum);
}

export function calculateResortAllocation(
  inputItems: InventoryResultCalculationItem[],
): InventoryResortAllocation {
  if (inputItems.length < 2) {
    throw new Error("Для пересорта нужно выбрать минимум две позиции.");
  }

  const groups = new Set(inputItems.map((item) => item.groupId ?? "").filter(Boolean));
  if (groups.size !== 1) {
    throw new Error("Для пересорта можно выбрать позиции только одной группы.");
  }

  const measures = new Set(inputItems.map((item) => item.measureUnitKey ?? "").filter(Boolean));
  if (measures.size !== 1) {
    throw new Error("Для пересорта можно выбрать позиции только одной единицы измерения.");
  }

  const source = inputItems
    .map((item) => ({
      id: item.id,
      amount: finite(item.differenceAmount),
      sum: finite(item.differenceSum),
    }))
    .filter((item) => Math.abs(item.amount) > EPSILON);

  const shortageTotal = source
    .filter((item) => item.amount < 0)
    .reduce((total, item) => total + Math.abs(item.amount), 0);
  const surplusTotal = source
    .filter((item) => item.amount > 0)
    .reduce((total, item) => total + item.amount, 0);

  if (shortageTotal <= EPSILON || surplusTotal <= EPSILON) {
    throw new Error("Для пересорта нужны и недостача, и излишек.");
  }

  const offsetAmount = roundMoney(Math.min(shortageTotal, surplusTotal));
  const shortageScale = offsetAmount / shortageTotal;
  const surplusScale = offsetAmount / surplusTotal;

  // Управленческая корректировка себестоимости.
  // Взвешенная средняя цена по shortage / surplus items (для multi-pair
  // случаев где несколько недостач и излишков покрываются взаимно).
  const shortageSumTotal = source
    .filter((item) => item.amount < 0)
    .reduce((total, item) => total + Math.abs(item.sum), 0);
  const surplusSumTotal = source
    .filter((item) => item.amount > 0)
    .reduce((total, item) => total + item.sum, 0);
  const shortageCostPerUnit = shortageTotal > EPSILON ? shortageSumTotal / shortageTotal : 0;
  const surplusCostPerUnit = surplusTotal > EPSILON ? surplusSumTotal / surplusTotal : 0;
  // Признаём только убыток (>=0): если недостача дороже излишка —
  // реальная потеря (списали дорогое, нашли дешёвое). Если излишек
  // оказался дороже недостачи — управленческий консерватизм не позволяет
  // признать «прибыль», корректировка = 0.
  const rawCostAdjustment = (shortageCostPerUnit - surplusCostPerUnit) * offsetAmount;
  const costAdjustmentSum = roundMoney(Math.max(0, rawCostAdjustment));

  const items = source.map((item): InventoryResortAllocationItem => {
    const role = item.amount < 0 ? "shortage" : "surplus";
    const offset = Math.abs(item.amount) * (role === "shortage" ? shortageScale : surplusScale);
    const remainingAbs = Math.max(0, Math.abs(item.amount) - offset);
    const remainingAmount = roundMoney(Math.sign(item.amount) * remainingAbs);
    const remainingSum = signedRemainderSum(item.amount, item.sum, remainingAmount);
    return {
      id: item.id,
      sourceDifferenceAmount: roundMoney(item.amount),
      sourceDifferenceSum: roundMoney(item.sum),
      offsetAmount: roundMoney(offset),
      remainingDifferenceAmount: remainingAmount,
      remainingDifferenceSum: remainingSum,
      role,
    };
  });

  return {
    offsetAmount,
    residualShortfallSum: roundMoney(
      items.filter((item) => item.remainingDifferenceSum < 0).reduce((total, item) => total + item.remainingDifferenceSum, 0),
    ),
    residualSurplusSum: roundMoney(
      items.filter((item) => item.remainingDifferenceSum > 0).reduce((total, item) => total + item.remainingDifferenceSum, 0),
    ),
    costAdjustmentSum,
    items,
  };
}

export function calculateManagementTotals(input: InventoryManagementTotalsInput): InventoryManagementTotals {
  const totals: InventoryManagementTotals = {
    qrShortfallSum: 0,
    qrSurplusSum: 0,
    managementShortfallSum: 0,
    managementSurplusSum: 0,
  };
  const resortByItemId = new Map((input.resortItems ?? []).map((item) => [item.id, item]));

  for (const item of input.items) {
    const qrSum = finite(item.differenceSum);
    if (qrSum < 0) totals.qrShortfallSum = roundMoney(totals.qrShortfallSum + qrSum);
    if (qrSum > 0) totals.qrSurplusSum = roundMoney(totals.qrSurplusSum + qrSum);

    if (item.excluded) continue;

    const resortItem = resortByItemId.get(item.id);
    addSignedDifference(
      totals,
      resortItem ? resortItem.remainingDifferenceSum : qrSum,
    );
  }

  // Корректировки себестоимости пересортов → плюсуются к
  // managementShortfallSum (плюс по модулю, как недостача — это убыток
  // с отрицательным знаком в формате shortfall: -сумма_убытка).
  // См. docs/handbook/inventory/resort.md.
  for (const adjustment of input.resortCostAdjustments ?? []) {
    if (!Number.isFinite(adjustment) || adjustment <= 0) continue;
    totals.managementShortfallSum = roundMoney(totals.managementShortfallSum - adjustment);
  }

  return totals;
}
