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
