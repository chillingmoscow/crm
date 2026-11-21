import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateOrdersDetailed, type Order, type OrderDetail } from "./calculate.ts";
import type { SalesSettings } from "./types.ts";

const settings = {
  tip_products: {},
  deposit_products: {},
  parking_product_ids: [],
} as unknown as SalesSettings;

const order = (id: number, payer: number | null, extra: Partial<Order> = {}): Order => ({
  id,
  payer_id: payer,
  gross: 1000,
  returned: false,
  deleted: false,
  status: "closed",
  ...extra,
});
const detail = (id: number, amount = 1000): OrderDetail => ({
  id,
  returned: false,
  deleted: false,
  service: 0,
  lines: [{ product_id: 1, amount, quantity: 1 }],
});

test("гостевые чеки — действующие чеки без Staff", () => {
  const orders = [order(1, null), order(2, 7), order(3, null), order(4, null, { status: "cancelled" })];
  const details = [detail(1), detail(2), detail(3), detail(4)];
  const { metrics, guestChecks } = calculateOrdersDetailed(orders, details, [7], settings);
  assert.equal(metrics.checks, 3);
  assert.equal(guestChecks, 2);
  assert.equal(metrics.turnover, 2000);
  assert.equal(metrics.staff_checks, 1000);
});
