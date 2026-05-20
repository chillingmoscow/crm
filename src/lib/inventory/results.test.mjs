import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateManagementTotals,
  calculateResortAllocation,
} from "./results.ts";

test("resort allocation offsets plus and minus and leaves the larger shortage remainder", () => {
  const allocation = calculateResortAllocation([
    {
      id: "cola",
      groupId: "soft",
      measureUnitKey: "pcs",
      differenceAmount: -13,
      differenceSum: -1300,
    },
    {
      id: "zero",
      groupId: "soft",
      measureUnitKey: "pcs",
      differenceAmount: 8,
      differenceSum: 800,
    },
  ]);

  const byId = new Map(allocation.items.map((item) => [item.id, item]));

  assert.equal(allocation.offsetAmount, 8);
  assert.equal(byId.get("cola")?.remainingDifferenceAmount, -5);
  assert.equal(byId.get("cola")?.remainingDifferenceSum, -500);
  assert.equal(byId.get("zero")?.remainingDifferenceAmount, 0);
  assert.equal(byId.get("zero")?.remainingDifferenceSum, 0);
  assert.equal(allocation.residualShortfallSum, -500);
  assert.equal(allocation.residualSurplusSum, 0);
});

test("resort allocation rejects mixed group or measure unit rows", () => {
  assert.throws(
    () =>
      calculateResortAllocation([
        {
          id: "cola",
          groupId: "soft",
          measureUnitKey: "pcs",
          differenceAmount: -1,
          differenceSum: -100,
        },
        {
          id: "whiskey",
          groupId: "alcohol",
          measureUnitKey: "pcs",
          differenceAmount: 1,
          differenceSum: 100,
        },
      ]),
    /одной группы/i,
  );

  assert.throws(
    () =>
      calculateResortAllocation([
        {
          id: "cola",
          groupId: "soft",
          measureUnitKey: "pcs",
          differenceAmount: -1,
          differenceSum: -100,
        },
        {
          id: "cola-liter",
          groupId: "soft",
          measureUnitKey: "l",
          differenceAmount: 1,
          differenceSum: 100,
        },
      ]),
    /одной единицы/i,
  );
});

test("management totals exclude ignored rows and use active resort remainders", () => {
  const resort = calculateResortAllocation([
    {
      id: "cola",
      groupId: "soft",
      measureUnitKey: "pcs",
      differenceAmount: -13,
      differenceSum: -1300,
    },
    {
      id: "zero",
      groupId: "soft",
      measureUnitKey: "pcs",
      differenceAmount: 8,
      differenceSum: 800,
    },
  ]);

  const totals = calculateManagementTotals({
    items: [
      { id: "cola", differenceAmount: -13, differenceSum: -1300 },
      { id: "zero", differenceAmount: 8, differenceSum: 800 },
      { id: "tonic", differenceAmount: 15, differenceSum: 1500, excluded: true },
    ],
    resortItems: resort.items,
  });

  assert.equal(totals.qrShortfallSum, -1300);
  assert.equal(totals.qrSurplusSum, 2300);
  assert.equal(totals.managementShortfallSum, -500);
  assert.equal(totals.managementSurplusSum, 0);
});

test("resort cost adjustment — равные себестоимости даёт 0", () => {
  // Виски A: -1 л за 3000; виски B: +1 л за 3000. Одна цена → корректировки нет.
  const allocation = calculateResortAllocation([
    {
      id: "whisky-a",
      groupId: "spirits",
      measureUnitKey: "l",
      differenceAmount: -1,
      differenceSum: -3000,
    },
    {
      id: "whisky-b",
      groupId: "spirits",
      measureUnitKey: "l",
      differenceAmount: 1,
      differenceSum: 3000,
    },
  ]);
  assert.equal(allocation.costAdjustmentSum, 0);
});

test("resort cost adjustment — недостача дороже излишка даёт убыток", () => {
  // Виски A (дорогой 5000): недостача 1 л; виски B (дешёвый 3000): излишек 1 л.
  // Список дорогое — нашли дешёвое → реальная потеря 2000.
  const allocation = calculateResortAllocation([
    {
      id: "whisky-premium",
      groupId: "spirits",
      measureUnitKey: "l",
      differenceAmount: -1,
      differenceSum: -5000,
    },
    {
      id: "whisky-basic",
      groupId: "spirits",
      measureUnitKey: "l",
      differenceAmount: 1,
      differenceSum: 3000,
    },
  ]);
  assert.equal(allocation.costAdjustmentSum, 2000);
});

test("resort cost adjustment — излишек дороже недостачи: только убыток признаём (0)", () => {
  // Виски A (дешёвый 3000): недостача 1 л; виски B (дорогой 5000): излишек 1 л.
  // Управленческий консерватизм: излишек дороже — «прибыль» не признаём.
  const allocation = calculateResortAllocation([
    {
      id: "whisky-basic",
      groupId: "spirits",
      measureUnitKey: "l",
      differenceAmount: -1,
      differenceSum: -3000,
    },
    {
      id: "whisky-premium",
      groupId: "spirits",
      measureUnitKey: "l",
      differenceAmount: 1,
      differenceSum: 5000,
    },
  ]);
  assert.equal(allocation.costAdjustmentSum, 0);
});

test("resort cost adjustment — multi-pair: взвешенное среднее по сторонам", () => {
  // Недостача: 2 л premium (5000) + 1 л middle (4000) = 14000 / 3 л = 4666.67 средняя.
  // Излишек: 3 л basic (3000) = 9000 / 3 л = 3000 средняя.
  // offsetAmount = min(3, 3) = 3.
  // costAdjustment = (4666.67 - 3000) × 3 = 5000.
  const allocation = calculateResortAllocation([
    {
      id: "premium",
      groupId: "spirits",
      measureUnitKey: "l",
      differenceAmount: -2,
      differenceSum: -10000,
    },
    {
      id: "middle",
      groupId: "spirits",
      measureUnitKey: "l",
      differenceAmount: -1,
      differenceSum: -4000,
    },
    {
      id: "basic",
      groupId: "spirits",
      measureUnitKey: "l",
      differenceAmount: 3,
      differenceSum: 9000,
    },
  ]);
  assert.equal(allocation.costAdjustmentSum, 5000);
});

test("management totals: cost adjustment плюсуется к managementShortfallSum", () => {
  // 5000-shortfall + 3000-surplus пересорт = чистый объём 0, но cost adj 2000.
  // Управленческая недостача должна включать эту корректировку.
  const allocation = calculateResortAllocation([
    {
      id: "premium",
      groupId: "spirits",
      measureUnitKey: "l",
      differenceAmount: -1,
      differenceSum: -5000,
    },
    {
      id: "basic",
      groupId: "spirits",
      measureUnitKey: "l",
      differenceAmount: 1,
      differenceSum: 3000,
    },
  ]);
  const totals = calculateManagementTotals({
    items: [
      { id: "premium", differenceAmount: -1, differenceSum: -5000 },
      { id: "basic", differenceAmount: 1, differenceSum: 3000 },
    ],
    resortItems: allocation.items,
    resortCostAdjustments: [allocation.costAdjustmentSum],
  });
  // QR-suммы — оригинальные.
  assert.equal(totals.qrShortfallSum, -5000);
  assert.equal(totals.qrSurplusSum, 3000);
  // Управленческая: residual = 0 для обеих позиций, но cost adj = -2000.
  assert.equal(totals.managementShortfallSum, -2000);
  assert.equal(totals.managementSurplusSum, 0);
});
