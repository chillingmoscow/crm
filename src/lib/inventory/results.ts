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

  return totals;
}
